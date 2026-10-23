// <gramps-connect-story src="josef.story.zip"></gramps-connect-story>: a
// story on any web page, from one script tag and no build step. Built into
// dist/embed.js with React, maplibre and the player inside it; the map's
// two worker files ship next to it.
//
// Attributes:
//   src    URL of a .story.zip (needs CORS if on another site)
//   slide  slide to open on: an index, or a slide id like "s3"
//   theme  "light", "dark", or "auto" (the default: the viewer's setting)
//   brand  present: the Story Viewer's icon before the title, linking to
//          it (for a page that is just the story, e.g. one a program wrote)
//
// It renders into a shadow root, so the page's CSS and the player's can't
// collide, and is 480px tall unless the page styles it otherwise.
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as maplibregl from "maplibre-gl";
// Text, not a side effect: it has to go inside the shadow root.
import maplibreCss from "maplibre-gl/dist/maplibre-gl.css";
import { mediaBlob, readStoryZip, type StoryPackage } from "../index";
import { StoryPlayer, ViewerBrand } from "../player";

/** maplibre's worker sits next to this script. Same origin: use it as is.
 * Another origin (the usual case, a CDN): a page can't start a worker from
 * another origin's URL, but it can start one from a blob: URL that imports
 * it, given CORS -- which the CDNs that serve npm packages send. */
function configureWorker(): void {
  const worker = new URL("./maplibre-gl-worker.mjs", import.meta.url);
  if (worker.origin === location.origin) {
    maplibregl.setWorkerUrl(worker.href);
  } else {
    const shim = new Blob([`import ${JSON.stringify(worker.href)};`], { type: "text/javascript" });
    maplibregl.setWorkerUrl(URL.createObjectURL(shim));
  }
}

const STYLE = `
:host { display: block; position: relative; height: 480px; overflow: hidden; font-family: system-ui, sans-serif; }
.frame { position: absolute; inset: 0; }
.message { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px;
  text-align: center; font-size: 14px; color: #868e96; }
${maplibreCss}
`;

class GrampsConnectStoryElement extends HTMLElement {
  static observedAttributes = ["src", "slide", "theme", "brand"];

  private frame: HTMLDivElement | null = null;
  private reactRoot: Root | null = null;
  private urls = new Map<string, string>();
  private story: StoryPackage | null = null;
  private loadId = 0;
  private darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  private onSchemeChange = () => this.render();

  connectedCallback() {
    if (!this.shadowRoot) {
      const shadow = this.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = STYLE;
      this.frame = document.createElement("div");
      this.frame.className = "frame";
      shadow.append(style, this.frame);
    }
    this.reactRoot ??= createRoot(this.frame!);
    this.darkQuery.addEventListener("change", this.onSchemeChange);
    void this.load();
  }

  disconnectedCallback() {
    this.darkQuery.removeEventListener("change", this.onSchemeChange);
    this.loadId += 1;
    this.reactRoot?.unmount();
    this.reactRoot = null;
    this.release();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
    if (!this.reactRoot || oldValue === newValue) return;
    if (name === "src") void this.load();
    else this.render();
  }

  private release() {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.story = null;
  }

  private message(text: string) {
    this.reactRoot?.render(createElement("div", { className: "message", role: "status" }, text));
  }

  private async load() {
    const id = ++this.loadId;
    const src = this.getAttribute("src");
    this.release();
    if (!src) {
      this.message("No story: set this element's src to a .story.zip.");
      return;
    }
    this.message("Loading story…");
    try {
      const res = await fetch(new URL(src, document.baseURI));
      if (!res.ok) throw new Error(`couldn't fetch it (${res.status})`);
      const story = await readStoryZip(await res.blob());
      if (id !== this.loadId) return;
      this.story = story;
      this.render();
    } catch (err) {
      if (id !== this.loadId) return;
      this.message(`This story couldn't be opened: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private resolveMedia = async (key: string): Promise<string | null> => {
    const cached = this.urls.get(key);
    if (cached) return cached;
    const blob = this.story && mediaBlob(this.story, key);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.urls.set(key, url);
    return url;
  };

  private initialSlide(): number {
    const slide = this.getAttribute("slide");
    if (!slide || !this.story) return 0;
    const byId = this.story.doc.slides.findIndex((s) => s.id === slide);
    if (byId >= 0) return byId;
    const n = Number(slide);
    return Number.isInteger(n) ? n : 0;
  }

  private render() {
    if (!this.reactRoot || !this.story) return;
    const theme = this.getAttribute("theme");
    const dark = theme === "dark" || (theme !== "light" && this.darkQuery.matches);
    this.reactRoot.render(createElement(StoryPlayer, {
      story: this.story.doc,
      resolveMedia: this.resolveMedia,
      dark,
      // One of maybe several on the page: arrow keys only once focused.
      keyboard: "focus",
      initialSlide: this.initialSlide(),
      brand: this.hasAttribute("brand") ? createElement(ViewerBrand) : undefined,
    }));
  }
}

configureWorker();
if (!customElements.get("gramps-connect-story")) {
  customElements.define("gramps-connect-story", GrampsConnectStoryElement);
}
