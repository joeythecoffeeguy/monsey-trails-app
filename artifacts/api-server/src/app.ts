import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));
const jsonParser = express.json();
const urlencodedParser = express.urlencoded({ extended: true });
// Admin authorization and origin checks run before parsing credentials. Besides
// failing closed sooner, this keeps malformed password bodies out of parser
// errors until after the caller has been authorized.
app.use((req, res, next) => req.path.startsWith("/api/admin") ? next() : jsonParser(req, res, next));
app.use((req, res, next) => req.path.startsWith("/api/admin") ? next() : urlencodedParser(req, res, next));
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);
const apiErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) { next(error); return; }
  if (req.path.startsWith("/api/admin")) {
    res.set("Cache-Control", "no-store");
    const status = error?.status === 400 ? 400 : 500;
    req.log.warn({
      action: "admin_request_error",
      status,
      errorType: typeof error?.name === "string" ? error.name : "Error",
    }, "Administrator API request failed");
    res.status(status).json({
      error: status === 400 ? "The request body is not valid JSON." : "The administrator request could not be completed.",
      code: status === 400 ? "INVALID_JSON" : "ADMIN_REQUEST_FAILED",
    });
    return;
  }
  if (error?.status === 409) {
    res.status(409).json({ error: error.message });
    return;
  }
  req.log.error({ err: error }, "API request failed");
  res.status(500).json({ error: "The request could not be completed. Please try again." });
};
app.use(apiErrorHandler);

export default app;
