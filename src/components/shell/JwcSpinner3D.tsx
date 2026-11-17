"use client";

import { useEffect, useRef } from "react";
import { jwcLogoShapes } from "./jwcLogoShapes";

/**
 * The JWC logo as a solid 3D object, turning slowly. Three.js is loaded only when this mounts,
 * so pages don't pay for it. With "reduce motion" on, or without WebGL, the flat logo shows.
 */
export function JwcSpinner3D({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let disposed = false;
    let cleanup = () => {};

    import("three").then((THREE) => {
      if (disposed) return;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        return; // No WebGL: keep the flat logo.
      }
      const { width, height } = host.getBoundingClientRect();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.style.position = "absolute";
      renderer.domElement.style.inset = "0";
      host.appendChild(renderer.domElement);
      host.dataset.ready = "true";

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);
      camera.position.set(0, 0, 8.5);

      const shapes = jwcLogoShapes.map(({ o, h }) => {
        const shape = new THREE.Shape(o.map(([x, y]) => new THREE.Vector2(x, y)));
        shape.holes = h.map((ring) => new THREE.Path(ring.map(([x, y]) => new THREE.Vector2(x, y))));
        return shape;
      });
      const geometry = new THREE.ExtrudeGeometry(shapes, {
        depth: 0.8,
        bevelEnabled: true,
        bevelThickness: 0.06,
        bevelSize: 0.03,
        bevelSegments: 3,
        curveSegments: 4,
      });
      geometry.center();
      const material = new THREE.MeshStandardMaterial({ color: 0x151515, metalness: 0.35, roughness: 0.35 });
      const logo = new THREE.Mesh(geometry, material);
      scene.add(logo);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8c85, 1.6));
      const key = new THREE.DirectionalLight(0xffffff, 2.4);
      key.position.set(4, 5, 8);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xffffff, 1.6);
      rim.position.set(-6, -2, -6);
      scene.add(rim);

      let frame = 0;
      const start = performance.now();
      const tick = (now: number) => {
        const t = (now - start) / 1000;
        logo.rotation.y = t * 1.6; // about one turn every 4 seconds
        logo.rotation.x = Math.sin(t * 1.2) * 0.12;
        renderer.render(scene, camera);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);

      cleanup = () => {
        cancelAnimationFrame(frame);
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return (
    <div ref={hostRef} className={`group relative ${className ?? ""}`}>
      {/* Flat logo until the 3D one is drawn (and for reduced motion). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/jwc-logo-black.png"
        alt=""
        className="absolute inset-0 m-auto h-1/2 w-auto animate-pulse group-data-[ready=true]:hidden"
      />
    </div>
  );
}
