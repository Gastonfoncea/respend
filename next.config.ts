import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node:sqlite es un builtin; se deja fuera del bundle del server.
  serverExternalPackages: [],
  experimental: {
    serverActions: {
      // Comprobantes de hasta 4 MB más el resto del formulario.
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
