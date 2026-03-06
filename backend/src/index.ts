import { app } from "./app";
import { env } from "./config/env";

const port = env.port;

app.listen(port, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`Backend API listening on http://localhost:${port}`);
});

