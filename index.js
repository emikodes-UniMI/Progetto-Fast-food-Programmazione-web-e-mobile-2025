import express from "express";
import { MongoClient } from "mongodb";
import config from "./utils/config.js";
import usersRouter from "./routes/users.js";
import mealsRouter from "./routes/meals.js";
import restaurantsRouter from "./routes/restaurants.js";
import ordersRouter from "./routes/orders.js";
import cartsRouter from "./routes/carts.js";
import cors from "cors"
import swaggerUi from 'swagger-ui-express'
import fs from 'fs';

const swaggerDocument = JSON.parse(fs.readFileSync('./Documents/swagger.json', 'utf-8'));

const app = express();

app.use(express.json());

app.use(cors())

app.use('/swagger', swaggerUi.serve, swaggerUi.setup(swaggerDocument));


let db;

async function startServer() {
  try {
    const client = new MongoClient(config.MONGODB_URI);
    await client.connect();
    app.locals.db = client.db("fastfood");

    app.get("/", (req, res) => {
      res.send("Server Attivo");
    });

    app.use("/users", usersRouter);
    app.use("/meals", mealsRouter);
    app.use("/restaurants", restaurantsRouter);
    app.use("/orders", ordersRouter);
    app.use("/carts", cartsRouter);

    app.use((err, req, res, next) => {
      console.error("Errore:", err.message);
      res.status(err.status || 500).json({ error: err.message });
    });

    const PORT = config.PORT;
    app.listen(PORT, () => {
      console.log(`Server avviato su http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Errore durante la connessione a MongoDB:", err.message);
    process.exit(1);
  }
}

startServer();
