import { forwardToApi } from "@/lib/backend";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Serveur MCP de Dexlane, pour les agents : `https://<domaine>/mcp`, avec `Authorization: Bearer <jeton d'agent>`
 * (créé dans Réglages › Agents). Streamable HTTP, sans session : chaque requête POST porte un message JSON-RPC.
 */
async function handle(req: Request): Promise<Response> {
  try {
    const upstream = await forwardToApi("/api/mcp", req);
    const headers = new Headers({ "Cache-Control": "no-store" });
    for (const name of ["content-type", "allow", "www-authenticate"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (e) {
    console.error(e);
    return Response.json({ jsonrpc: "2.0", error: { code: -32603, message: "the dexlane API is not reachable" }, id: null }, { status: 502 });
  }
}

export { handle as GET, handle as POST, handle as DELETE };
