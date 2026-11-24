// A list that loads a page at a time and remembers which row is selected.

/**
 * One page of rows. `total` is how many rows exist in all, so the list knows whether to ask for more.
 * @template T
 * @typedef {{ rows: T[], total: number } | { error: string }} Page
 */

/** @template T */
export class PagedList {
  /** @param {(offset: number) => Promise<Page<T>>} loadPage reads the page that starts at row `offset` */
  constructor(loadPage) {
    this.loadPage = loadPage;
    /** @type {T[]} */
    this.rows = [];
    /** How many rows exist in all. More than `rows.length` means more pages can load. */
    this.total = 0;
    /** The selected row's index. */
    this.at = 0;
    /** True once a first page has arrived (or failed). */
    this.loaded = false;
    /** True while a page is on its way. */
    this.loading = false;
    /** @type {string | null} why the last load failed */
    this.error = null;
    /** Counts reloads, so a page from before a reload is dropped. */
    this.turn = 0;
  }

  /** @returns {T | undefined} */
  selected() {
    return this.rows[this.at];
  }

  /** Moves the selection, stopping at both ends. @param {number} delta */
  move(delta) {
    this.at = Math.max(0, Math.min(this.rows.length - 1, this.at + delta));
  }

  /** True when the selection is near the end and more rows exist. */
  wantsMore() {
    return !this.loading && !this.error && this.rows.length < this.total && this.at >= this.rows.length - 3;
  }

  /** Empties the list, so the next show loads it again. */
  clear() {
    this.turn += 1;
    this.rows = [];
    this.total = 0;
    this.at = 0;
    this.loaded = false;
    this.loading = false;
    this.error = null;
  }

  /** Loads the first page again. Keeps the selection's index when it still exists. */
  async reload() {
    const turn = ++this.turn;
    this.loading = true;
    this.error = null;
    const page = await this.loadPage(0);
    if (turn !== this.turn) return;
    this.loading = false;
    this.loaded = true;
    if ("error" in page) { this.error = page.error; this.rows = []; this.total = 0; }
    else { this.rows = page.rows; this.total = page.total; }
    this.at = Math.max(0, Math.min(this.at, this.rows.length - 1));
  }

  /** Loads the next page onto the end. */
  async loadMore() {
    if (this.loading || this.rows.length >= this.total) return;
    const turn = this.turn;
    this.loading = true;
    const page = await this.loadPage(this.rows.length);
    if (turn !== this.turn) return;
    this.loading = false;
    // A failed or empty extra page ends the list where it is.
    if ("error" in page || page.rows.length === 0) this.total = this.rows.length;
    else { this.rows = this.rows.concat(page.rows); this.total = Math.max(page.total, this.rows.length); }
  }
}
