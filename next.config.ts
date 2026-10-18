import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pg y PGlite (WASM, solo desarrollo local) se cargan desde node_modules, sin empaquetar.
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
  experimental: {
    serverActions: {
      // Comprobantes de hasta 4 MB más el resto del formulario.
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
