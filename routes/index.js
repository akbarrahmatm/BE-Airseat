const router = require("express").Router();
const swaggerUI = require("swagger-ui-express");
const swaggerDocument = require("../docs/swagger.json");

/*
    Import other routers here, for example:
    const authRouter = require("./authRouter");
*/

const authRouter = require("./authRouter");

/*
    Define other routes here, for example:
    router.use("/api/v1/auth", authRouter);
*/

// Swagger docs
router.use("/api-docs", swaggerUI.serve);
router.use("/api-docs", swaggerUI.setup(swaggerDocument));

router.use("/api/v1/auth", authRouter);

module.exports = router;
