import { randomUUID } from "node:crypto";
import { DriveClient, FOLDER_MIME, type DriveFile } from "../src/storage/drive";

interface Node extends DriveFile {
  bytes?: Uint8Array;
}

export const ROOT_ID = "ROOT00000000000000000000000000001";
export const OTHER_ID = "OTHER0000000000000000000000000001"; // a folder outside the Aircraft Media root

/**
 * In-memory stand-in for the Google Drive v3 REST API (the subset the client uses),
 * exposed as a `fetch` implementation. This tests the real request-building and parsing code;
 * it is NOT a live Google verification.
 */
export class FakeDrive {
  nodes = new Map<string, Node>();
  tokenCalls = 0;
  downloads: string[] = [];
  failDownload = new Set<string>();
  pageSize = 2;
  private n = 0;

  constructor() {
    this.nodes.set(ROOT_ID, { id: ROOT_ID, name: "Aircraft Media", mimeType: FOLDER_MIME, parents: [] });
    this.nodes.set(OTHER_ID, { id: OTHER_ID, name: "Somewhere else", mimeType: FOLDER_MIME, parents: [] });
  }

  private id(prefix: string) {
    return `${prefix}${String(++this.n).padStart(12, "0")}${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  }

  addFolder(name: string, parent: string): string {
    const id = this.id("FOLDER");
    this.nodes.set(id, { id, name, mimeType: FOLDER_MIME, parents: [parent] });
    return id;
  }

  addFile(name: string, mimeType: string, bytes: Uint8Array, parent: string): string {
    const id = this.id("FILE");
    this.nodes.set(id, { id, name, mimeType, parents: [parent], bytes, md5Checksum: `md5-${id}`, headRevisionId: `rev-1`, modifiedTime: new Date().toISOString(), size: String(bytes.length) });
    return id;
  }

  /** Simulates an edit in Drive: new bytes and a new revision. */
  editFile(id: string, bytes: Uint8Array) {
    const f = this.nodes.get(id)!;
    f.bytes = bytes;
    f.headRevisionId = `rev-${Number((f.headRevisionId ?? "rev-1").split("-")[1]) + 1}`;
    f.modifiedTime = new Date().toISOString();
  }

  remove(id: string) {
    this.nodes.delete(id);
  }

  childrenOf(id: string) {
    return [...this.nodes.values()].filter((x) => x.parents?.includes(id) && !x.trashed);
  }

  client(): DriveClient {
    return new DriveClient(ROOT_ID, { clientId: "cid", clientSecret: "secret", refreshToken: "refresh" }, (u, i) => this.fetch(u, i));
  }

  private json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  private pub(n: Node): DriveFile {
    const { bytes: _b, ...rest } = n;
    void _b;
    return rest;
  }

  async fetch(input: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(input);
    if (url.origin === "https://oauth2.googleapis.com") {
      this.tokenCalls++;
      const body = new URLSearchParams(String(init.body));
      if (body.get("refresh_token") !== "refresh") return this.json({ error: "invalid_grant" }, 400);
      return this.json({ access_token: "tok", expires_in: 3600 });
    }
    const auth = (init.headers as Record<string, string> | undefined)?.Authorization;
    if (auth !== "Bearer tok") return this.json({ error: "unauthorized" }, 401);

    const method = (init.method ?? "GET").toUpperCase();
    const path = url.pathname;

    if (path === "/upload/drive/v3/files" && method === "POST") {
      const ct = (init.headers as Record<string, string>)["Content-Type"];
      const boundary = ct.split("boundary=")[1];
      const body = Buffer.from(init.body as Uint8Array);
      const b = Buffer.from(`--${boundary}`);
      const p1 = body.indexOf(b);
      const h1 = body.indexOf("\r\n\r\n", p1) + 4;
      const e1 = body.indexOf(`\r\n--${boundary}`, h1);
      const meta = JSON.parse(body.subarray(h1, e1).toString("utf8")) as { name: string; parents: string[] };
      const h2 = body.indexOf("\r\n\r\n", e1) + 4;
      const e2 = body.lastIndexOf(`\r\n--${boundary}--`);
      const mime = /Content-Type: ([^\r]+)/.exec(body.subarray(e1, h2).toString("latin1"))?.[1] ?? "application/octet-stream";
      const id = this.addFile(meta.name, mime, new Uint8Array(body.subarray(h2, e2)), meta.parents[0]);
      return this.json({ id });
    }

    if (path === "/drive/v3/files" && method === "POST") {
      const meta = JSON.parse(String(init.body)) as { name: string; mimeType: string; parents: string[] };
      return this.json({ id: this.addFolder(meta.name, meta.parents[0]) });
    }

    if (path === "/drive/v3/files" && method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      let rows = parent ? this.childrenOf(parent) : [];
      const name = /name = '((?:\\'|[^'])*)'/.exec(q)?.[1]?.replace(/\\'/g, "'");
      if (name) rows = rows.filter((r) => r.name === name);
      if (q.includes(`mimeType = '${FOLDER_MIME}'`)) rows = rows.filter((r) => r.mimeType === FOLDER_MIME);
      const start = Number(url.searchParams.get("pageToken") ?? 0);
      const page = rows.slice(start, start + this.pageSize);
      const next = start + this.pageSize < rows.length ? String(start + this.pageSize) : undefined;
      return this.json({ files: page.map((r) => this.pub(r)), nextPageToken: next });
    }

    const up = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (up && method === "PATCH") {
      const node = this.nodes.get(decodeURIComponent(up[1]));
      if (!node) return this.json({ error: "not found" }, 404);
      node.bytes = new Uint8Array(init.body as Uint8Array);
      return this.json({ id: node.id });
    }

    const m = /^\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (m && method === "PATCH") {
      const node = this.nodes.get(decodeURIComponent(m[1]));
      if (!node) return this.json({ error: "not found" }, 404);
      const body = JSON.parse(String(init.body)) as { name?: string; trashed?: boolean };
      if (body.name) node.name = body.name;
      if (body.trashed) node.trashed = true;
      const add = url.searchParams.get("addParents"), remove = url.searchParams.get("removeParents");
      if (add && remove) node.parents = [...(node.parents ?? []).filter((p) => p !== remove), add];
      return this.json({ id: node.id });
    }
    if (m && method === "GET") {
      const id = decodeURIComponent(m[1]);
      const node = this.nodes.get(id);
      if (!node) return this.json({ error: "not found" }, 404);
      if (url.searchParams.get("alt") === "media") {
        this.downloads.push(id);
        if (this.failDownload.has(id)) return this.json({ error: "backend error" }, 500);
        return new Response(Buffer.from(node.bytes ?? new Uint8Array()));
      }
      return this.json(this.pub(node));
    }
    return this.json({ error: "unsupported in fake" }, 400);
  }
}
