import { AwsClient } from "aws4fetch";

export interface R2Bucket {
  put(key: string, body: Uint8Array | string, contentType: string, cacheControl?: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export function r2FromEnv(bucket: string): R2Bucket {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("set R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY");
  }
  const aws = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
  const base = `${endpoint.replace(/\/$/, "")}/${bucket}`;
  const objectUrl = (key: string) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;

  const check = async (response: Response, what: string) => {
    if (!response.ok) throw new Error(`r2 ${what}: ${response.status} ${await response.text()}`);
    return response;
  };

  return {
    async put(key, body, contentType, cacheControl = "public, max-age=31536000, immutable") {
      const response = await aws.fetch(objectUrl(key), {
        method: "PUT",
        body: body as BodyInit,
        headers: { "content-type": contentType, "cache-control": cacheControl },
      });
      await check(response, `PUT ${key}`);
    },

    async get(key) {
      const response = await aws.fetch(objectUrl(key));
      if (response.status === 404) return null;
      return new Uint8Array(await (await check(response, `GET ${key}`)).arrayBuffer());
    },

    async delete(key) {
      await check(await aws.fetch(objectUrl(key), { method: "DELETE" }), `DELETE ${key}`);
    },

    async list(prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const query = new URLSearchParams({ "list-type": "2", prefix, "max-keys": "1000" });
        if (token) query.set("continuation-token", token);
        const xml = await (await check(await aws.fetch(`${base}?${query}`), `LIST ${prefix}`)).text();
        for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(decodeXml(match[1]));
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
          ? decodeXml(xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1] ?? "")
          : undefined;
      } while (token);
      return keys;
    },
  };
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
