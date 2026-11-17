import type { FileStore, StorageArea, StorageKind } from "./index";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  trashed?: boolean;
  md5Checksum?: string;
  headRevisionId?: string;
  modifiedTime?: string;
  size?: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class DriveError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "DriveError";
  }
}

const FIELDS = "id,name,mimeType,parents,trashed,md5Checksum,headRevisionId,modifiedTime,size";
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/**
 * Minimal Google Drive v3 client. Everything is confined to the configured `Aircraft Media` root:
 * listing and imports require the target to be a descendant of that root; new files are written under it.
 * Secrets stay server-side; the access token is obtained from a refresh token held in the environment.
 */
export class DriveClient {
  private token?: { value: string; expiresAt: number };
  private ancestry = new Map<string, boolean>();
  private folders = new Map<string, string>();

  constructor(
    public rootFolderId: string,
    private creds: { clientId: string; clientSecret: string; refreshToken: string },
    private fetchImpl: FetchLike = (u, i) => fetch(u, i),
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const res = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.creds.clientId,
        client_secret: this.creds.clientSecret,
        refresh_token: this.creds.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new DriveError("Google Drive authorisation failed. Re-run the Drive authorisation step.", res.status);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await this.fetchImpl(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${await this.accessToken()}` } });
    if (!res.ok) throw new DriveError(`Google Drive request failed (${res.status})`, res.status);
    return res;
  }

  async getFile(id: string): Promise<DriveFile> {
    return (await (await this.call(`${API}/files/${encodeURIComponent(id)}?fields=${FIELDS}&supportsAllDrives=true`)).json()) as DriveFile;
  }

  /** True when `id` is the root or lives somewhere beneath it. Cached per client. */
  async isWithinRoot(id: string): Promise<boolean> {
    let cur = id;
    const trail: string[] = [];
    for (let depth = 0; depth < 25; depth++) {
      if (cur === this.rootFolderId) {
        trail.forEach((t) => this.ancestry.set(t, true));
        this.ancestry.set(cur, true);
        return true;
      }
      const known = this.ancestry.get(cur);
      if (known !== undefined) {
        trail.forEach((t) => this.ancestry.set(t, known));
        return known;
      }
      trail.push(cur);
      let f: DriveFile;
      try {
        f = await this.getFile(cur);
      } catch {
        break;
      }
      if (f.trashed || !f.parents?.length) break;
      cur = f.parents[0];
    }
    trail.forEach((t) => this.ancestry.set(t, false));
    return false;
  }

  /** Direct children of a folder (metadata only; nothing is downloaded here). */
  async listChildren(folderId: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    const q = `'${esc(folderId)}' in parents and trashed = false`;
    do {
      const url = `${API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(`nextPageToken,files(${FIELDS})`)}&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
      const j = (await (await this.call(url)).json()) as { files: DriveFile[]; nextPageToken?: string };
      out.push(...j.files);
      pageToken = j.nextPageToken;
    } while (pageToken);
    return out;
  }

  async download(id: string): Promise<Uint8Array> {
    const res = await this.call(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Find or create a named sub-folder under `parentId` (idempotent). */
  async ensureFolder(parentId: string, name: string): Promise<string> {
    const cacheKey = `${parentId}/${name}`;
    const cached = this.folders.get(cacheKey);
    if (cached) return cached;
    const q = `'${esc(parentId)}' in parents and name = '${esc(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const found = (await (await this.call(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`)).json()) as { files: { id: string }[] };
    let id = found.files[0]?.id;
    if (!id) {
      const res = await this.call(`${API}/files?fields=id&supportsAllDrives=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
      });
      id = ((await res.json()) as { id: string }).id;
    }
    this.folders.set(cacheKey, id);
    return id;
  }

  async upload(parentId: string, name: string, mimeType: string, bytes: Uint8Array): Promise<string> {
    const boundary = `----aircraft-media-${Math.random().toString(36).slice(2)}`;
    const meta = JSON.stringify({ name, parents: [parentId] });
    const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
    const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head, 0);
    body.set(bytes, head.length);
    body.set(tail, head.length + bytes.length);
    const res = await this.call(`${UPLOAD}?uploadType=multipart&fields=id&supportsAllDrives=true`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    return ((await res.json()) as { id: string }).id;
  }
}

/** Bytes stored in the `Aircraft Media` root: Sources/ for originals, Processing/ for derivatives. */
export class DriveFileStore implements FileStore {
  kind = "drive" as const;
  constructor(private client: DriveClient) {}

  async put(bytes: Uint8Array, name: string, area: StorageArea = "Sources", mimeType = "application/octet-stream"): Promise<string> {
    const folder = await this.client.ensureFolder(this.client.rootFolderId, area);
    return this.client.upload(folder, name, mimeType, bytes);
  }

  async get(ref: string, _kind?: StorageKind): Promise<Uint8Array> {
    return this.client.download(ref);
  }
}

export function driveClientFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl?: FetchLike): DriveClient | null {
  const { AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN, GOOGLE_DRIVE_ROOT_FOLDER_ID } = env;
  if (!AUTH_GOOGLE_ID || !AUTH_GOOGLE_SECRET || !GOOGLE_DRIVE_REFRESH_TOKEN || !GOOGLE_DRIVE_ROOT_FOLDER_ID) return null;
  return new DriveClient(GOOGLE_DRIVE_ROOT_FOLDER_ID, { clientId: AUTH_GOOGLE_ID, clientSecret: AUTH_GOOGLE_SECRET, refreshToken: GOOGLE_DRIVE_REFRESH_TOKEN }, fetchImpl);
}
