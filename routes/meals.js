import express from "express";
import { ObjectId } from "mongodb";
import authenticateUser from "../middlewares/authenticateUser.js";
import authorizeRistoratore from "../middlewares/authorizeRistoratore.js";

const mealsRouter = express.Router();

// GET /meals - Restituisce tutti i piatti, con filtri opzionali
mealsRouter.get("/", async (req, res) => {
  try {
    const db = req.app.locals.db;
    const {
      strCategory,
      strArea,
      nome,
      prezzoMin,
      prezzoMax,
      ristorante_id,
    } = req.query;

    const filter = {};

    if (strCategory) filter.strCategory = strCategory;
    if (strArea) filter.strArea = strArea;
    if (nome) {
      filter.strMeal = { $regex: nome, $options: "i" }; // case-insensitive
    }
    if (prezzoMin || prezzoMax) {
      filter.prezzo = {};
      if (prezzoMin) filter.prezzo.$gte = parseFloat(prezzoMin);
      if (prezzoMax) filter.prezzo.$lte = parseFloat(prezzoMax);
    }
    if (ristorante_id) {
      if (!ObjectId.isValid(ristorante_id)) {
        return res.status(400).json({ error: "ristorante_id non valido" });
      }
      filter.ristorante_id = new ObjectId(ristorante_id);
    }

    const meals = await db.collection("meals").find(filter).toArray();

    res.json(meals);
  } catch (err) {
    res.status(500).json({ error: "Errore nel recupero dei piatti" });
  }
});


// GET /meals/:id - Dettagli singolo piatto, identificato per _id 
mealsRouter.get("/:id", async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "ID non valido" });
    }

    const meal = await db.collection("meals").findOne({ _id: new ObjectId(id) });

    if (!meal) {
      return res.status(404).json({ error: "Piatto non trovato" });
    }

    res.json(meal);
  } catch (err) {
    res.status(500).json({ error: "Errore nel recupero del piatto" });
  }
});


// POST /meals - Aggiunta piatto personalizzato (Richiede autenticazione utente ristoratore)
mealsRouter.post("/", authenticateUser, authorizeRistoratore, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const user = req.user;

    const restaurant = await db.collection("restaurants").findOne({ ristoratore_id: new ObjectId(user._id) });

    if (!restaurant) {
      return res.status(403).json({ error: "Devi prima creare un ristorante per poter aggiungere piatti" });
    }

    const {
      strMeal,
      strCategory,
      strArea,
      strInstructions,
      strMealThumb,
      ingredients,
      measures,
      prezzo,
      tempo_preparazione,
    } = req.body;

    if (!strMeal || typeof strMeal !== "string") {
      return res.status(400).json({ error: "strMeal richiesto e stringa" });
    }

    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      return res.status(400).json({ error: "ingredients deve essere un array non vuoto" });
    }

    if (!Array.isArray(measures) || measures.length !== ingredients.length) {
      return res.status(400).json({ error: "measures deve essere un array della stessa lunghezza di ingredients" });
    }

    if (typeof prezzo !== "number" || prezzo < 0) {
      return res.status(400).json({ error: "prezzo richiesto e deve essere un numero >= 0" });
    }

    if (typeof tempo_preparazione !== "number" || tempo_preparazione < 0) {
      return res.status(400).json({ error: "tempo_preparazione richiesto e deve essere un numero >= 0" });
    }

    const newMeal = {
      strMeal,
      strCategory,
      strArea,
      strInstructions,
      strMealThumb,
      ingredients,
      measures,
      prezzo,
      tempo_preparazione,
      ristorante_id: restaurant._id,
    };

    const result = await db.collection("meals").insertOne(newMeal);

    await db.collection("restaurants").updateOne(
      { _id: restaurant._id },
      { $push: { menu: result.insertedId } }
    );

    res.status(201).json({ ...newMeal, _id: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: "Errore nella creazione del piatto" });
  }
});



// PUT /meals/:id - Modifica piatto personalizzato (Richiede autenticazione utente ristoratore)
mealsRouter.put("/:id", authenticateUser, authorizeRistoratore, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const user = req.user;
    const id = req.params.id;
    let meal;

    const restaurant = await db.collection("restaurants").findOne({ ristoratore_id: new ObjectId(user._id) });

    if (!restaurant) {
      return res.status(403).json({ error: "Devi prima creare un ristorante" });
    }

    if (ObjectId.isValid(id)) {
      meal = await db.collection("meals").findOne({ _id: new ObjectId(id) });
    }

    if (!meal) {
      return res.status(404).json({ error: "Piatto non trovato" });
    }

    if (!meal.ristorante_id) {
      return res.status(403).json({ error: "Impossibile modificare piatti generali" });
    }

    // un ristoratore può modificare solo i piatti personalizzati del proprio ristorante
    if (meal.ristorante_id.toString() !== restaurant._id.toString()) {
      return res.status(403).json({ error: "Accesso negato: non proprietario del piatto" });
    }

    const allowedFields = [
      "strMeal", "strCategory", "strArea", "strInstructions",
      "strMealThumb", "ingredients", "measures",
      "prezzo", "tempo_preparazione"
    ];

    const updateFields = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateFields[field] = req.body[field];
      }
    }

    if ("ingredients" in updateFields && !Array.isArray(updateFields.ingredients)) {
      return res.status(400).json({ error: "ingredients deve essere un array" });
    }

    if ("measures" in updateFields && !Array.isArray(updateFields.measures)) {
      return res.status(400).json({ error: "measures deve essere un array" });
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ error: "Nessun campo valido da aggiornare" });
    }

    const result = await db.collection("meals").updateOne(
      { _id: new ObjectId(id) },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Piatto non trovato" });
    }

    res.json(await db.collection("meals").findOne({ _id: new ObjectId(id) }));
  } catch (err) {
    res.status(500).json({ error: "Errore interno del server" });
  }
});


// DELETE /meals/:id - Elimina piatto personalizzato (Richiede autenticazione utente ristoratore)
mealsRouter.delete("/:id", authenticateUser, authorizeRistoratore, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const user = req.user;
    const id = req.params.id;

    if (!ObjectId.isValid(id)) return res.status(400).json({ error: "ID non valido" });

    const meal = await db.collection("meals").findOne({ _id: new ObjectId(id) });

    if (!meal) return res.status(404).json({ error: "Piatto non trovato" });

    if (!meal.ristorante_id) {
      return res.status(403).json({ error: "Impossibile eliminare piatti generali" });
    }

    if (!user || user.role !== "ristoratore" || meal.ristorante_id.toString() !== user._id.toString()) {
      return res.status(403).json({ error: "Accesso negato: non proprietario del piatto" });
    }

    const result = await db.collection("meals").deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) return res.status(404).json({ error: "Piatto non trovato" });

    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: "aErrore nell'eliminazione del piatto" });
  }
});

export default mealsRouter;
