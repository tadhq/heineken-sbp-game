// Runs before the app on the client. Polyfills for older Android System WebViews (the
// stock Android 11 WebView is Chrome 91; see browserslist in package.json).

if (typeof CanvasRenderingContext2D !== "undefined" && !CanvasRenderingContext2D.prototype.roundRect) {
  // Chrome 99+. The games only pass a single numeric radius.
  CanvasRenderingContext2D.prototype.roundRect = function (x: number, y: number, w: number, h: number, radii?: number | DOMPointInit | Iterable<number | DOMPointInit>) {
    const r = Math.max(0, Math.min(typeof radii === "number" ? radii : 0, Math.abs(w) / 2, Math.abs(h) / 2));
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
  };
}
