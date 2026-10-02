"use client";

import { useEffect } from "react";

/** Root-layout failure: no app CSS or fonts are guaranteed here, so inline styles only. */
export default function GlobalError() {
  useEffect(() => {
    const id = setTimeout(() => window.location.replace("/"), 4000);
    return () => clearTimeout(id);
  }, []);
  return (
    <html lang="nl">
      <body style={{ margin: 0, background: "#03130a", color: "#f3f6f1", fontFamily: "sans-serif", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ fontSize: 28, fontWeight: 700 }}>One moment / Even geduld</p>
      </body>
    </html>
  );
}
