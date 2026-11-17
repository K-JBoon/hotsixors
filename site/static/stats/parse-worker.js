import { MPQArchive } from '../replay/mpq.js';
import { summarizeReplay } from '../replay/summary.js';

self.onmessage = async ({ data: { key, file } }) => {
  try {
    const archive = new MPQArchive(await file.arrayBuffer());
    self.postMessage({ key, summary: { id: key, ...(await summarizeReplay(archive)) } });
  } catch (error) {
    self.postMessage({ key, error: String(error?.message ?? error) });
  }
};
