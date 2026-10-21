"use client";

import dynamic from "next/dynamic";
import "@designcodeio/threeui/style.css";

// Loaded on the client after the form renders: the vendored component
// bundles every 3D Paper variant (~2.5 MB) and runs it in a sandboxed iframe.
const ThreeDPaper = dynamic(
  () => import("@designcodeio/threeui").then((mod) => mod.ThreeDPaper),
  { ssr: false },
);

export function ThreeDPaperBackground() {
  return (
    <div className="shader-frame h-full w-full overflow-hidden bg-[#08080a]">
      <ThreeDPaper variant="original" />
    </div>
  );
}
