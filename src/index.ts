import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

export function serviceName(): string {
  return "tbm-unicloudconnect";
}

export function createHttpServer() {
  return createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok", service: serviceName() }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  createHttpServer().listen(port, "0.0.0.0", () => {
    console.log(`${serviceName()} listening on ${port}`);
  });
}
