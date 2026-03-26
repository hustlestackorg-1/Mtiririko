require("dotenv").config();
const express = require("express");
const cors = require("cors");
const winston = require("winston");
const rateLimit = require("express-rate-limit");
const mpesaRoutes = require("./routes/mpesa");

// Configure Winston Logger
const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: "error.log", level: "error" }),
        new winston.transports.File({ filename: "combined.log" })
    ]
});

const app = express();

// Apply Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per `window`
    message: "Too many requests from this IP, please try again after 15 minutes",
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(limiter);
app.use(express.json());
app.use(cors());

// Pass logger to routes via locals
app.use((req, res, next) => {
    req.logger = logger;
    next();
});

app.get("/health", (req, res) => {
    logger.info("Health check endpoint pinged");
    res.json({ status: "Mtiririko Middleware is running optimally." });
});

app.use("/api/v1/mpesa", mpesaRoutes);

// Only start listening when run directly (not when imported by tests)
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        logger.info(`Middleware listening on port ${PORT}`);
    });
}

module.exports = app;
