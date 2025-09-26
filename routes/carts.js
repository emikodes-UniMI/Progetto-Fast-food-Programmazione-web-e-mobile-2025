import express from "express";
import authenticateUser from "../middlewares/authenticateUser.js";
import { ObjectId } from "mongodb";

/*Express.js è un framework per Node.js, che fornisce una serie di strumenti utili alla creazione di API, Middlewares, e per la semplificazione delle operazioni di routing*/

const cartsRouter = express.Router(); //definiamo un oggetto Router

/*Per Routing si intende determinare come la mia app risponde a richieste client, in base all'endpoint a cui vengono effettuate (Endpoint definire come URI + Metodo HTTP specifico)
  Vogliamo quindi definire un comportamento diverso del backend, in base all'URI e al metodo HTTP a cui vengono effettuate le richieste client.
  
  Definiamo una rotta:
  Router.HTTPMETHOD(URI, HANDLERFUNCTION)
  Dove HTTPMETHOD è un metodo di richiesta HTTP,
  URI è un percorso sul server
  HANDLER è la funzione che viene eseguita quando arriva una richiesta client all'URI specificato, col metodo METHOD*/

cartsRouter.get("/me", authenticateUser, async (req, res) => {
    try {
      const db = req.app.locals.db;
      const cart = await db.collection("carts").findOne({ user_id: new ObjectId(req.user._id) });
  
      if (!cart) return res.status(404).json({ error: "Carrello vuoto o non trovato." });
  
      res.json(cart);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Errore nel recupero del carrello" });
    }
  });
  
  //PUT /add - Aggiunge un piatto al carrello dell'utente autenticato, creando il carrello se non esistente
  cartsRouter.put("/add", authenticateUser, async (req, res) => {
    try {
      const db = req.app.locals.db;
      const { meal_id, quantita, prezzo_unitario, ristorante_id, nome } = req.body;
  
      if (!meal_id || !ObjectId.isValid(meal_id)) {
        return res.status(400).json({ error: "_id del piatto non valido" });
      }
  
      if (!ristorante_id || !ObjectId.isValid(ristorante_id)) {
        return res.status(400).json({ error: "ristorante_id non valido" });
      }
  
      let cart = await db.collection("carts").findOne({ user_id: new ObjectId(req.user._id) });
  
      if (!cart) {
        cart = { user_id: new ObjectId(req.user._id), meals: [] };
      }
  
      const mealIndex = cart.meals.findIndex(m => m._id.toString() === meal_id && m.ristorante_id.toString() === ristorante_id);
  
      if (mealIndex !== -1) {
        cart.meals[mealIndex].quantita += quantita;
      } else {
        cart.meals.push({
          _id: new ObjectId(meal_id),
          nome,
          quantita,
          prezzo_unitario,
          ristorante_id: new ObjectId(ristorante_id)
        });
      }
  
      await db.collection("carts").updateOne(
        { user_id: new ObjectId(req.user._id) },
        { $set: cart },
        { upsert: true }
      );
  
      res.json(cart);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Errore nell'aggiunta al carrello" });
    }
  });
  
  // PUT /carts/remove - Rimuovi un piatto dal carrello dell'utente autenticato, eliminando il carrello se rimane vuoto
  cartsRouter.put("/remove", authenticateUser, async (req, res) => {
    try {
      const db = req.app.locals.db;
      const { meal_id } = req.body;
  
      if (!meal_id || !ObjectId.isValid(meal_id)) {
        return res.status(400).json({ error: "_id del piatto non valido" });
      }
  
      const cart = await db.collection("carts").findOne({ user_id: new ObjectId(req.user._id) });
  
      if (!cart || cart.meals.length === 0) {
        return res.status(404).json({ error: "Carrello vuoto o non trovato" });
      }
      
      //tutti i piatti, tranne quello identificato per l'eliminazione
      cart.meals = cart.meals.filter(m => m._id.toString() !== meal_id);
  
      if (cart.meals.length === 0) {
        await db.collection("carts").deleteOne({ user_id: new ObjectId(req.user._id) });
        return res.json({ message: "Carrello eliminato poiché vuoto." });
      } else {
        await db.collection("carts").updateOne(
          { user_id: new ObjectId(req.user._id) },
          { $set: { meals: cart.meals } }
        );
        return res.json(cart);
      }
  
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Errore nella rimozione dal carrello" });
    }
  });
  
  
  
  // DELETE /carts/me - Elimina tutto il carrello
  cartsRouter.delete("/me", authenticateUser, async (req, res) => {
    try {
      const db = req.app.locals.db;
      await db.collection("carts").deleteOne({ user_id: new ObjectId(req.user._id) });
      res.json({ message: "Carrello eliminato correttamente." });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Errore durante l'eliminazione del carrello" });
    }
  });
  
  export default cartsRouter;