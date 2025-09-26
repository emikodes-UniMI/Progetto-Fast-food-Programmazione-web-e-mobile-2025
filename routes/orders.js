import express from "express";
import { ObjectId } from "mongodb";
import authenticateUser from "../middlewares/authenticateUser.js";
import authorizeRistoratore from "../middlewares/authorizeRistoratore.js";
import { DateTime } from "luxon";

const ordersRouter = express.Router();
const validStates = ["ordinato", "in preparazione", "in consegna", "consegnato"];

// POST /orders - Crea nuovo ordine per l'utente autenticato
ordersRouter.post("/", authenticateUser, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const user = req.user;

    if (user.role !== "cliente") {
      return res.status(403).json({ error: "Solo i clienti possono creare ordini" });
    }

    const { meals, metodo_consegna } = req.body;

    console.log(req.body)

    if (!Array.isArray(meals) || meals.length === 0) {
      return res.status(400).json({ error: "meals deve essere un array non vuoto" });
    }

    let ordiniPerRistoranti = {};

    for (const m of meals) {
      if (!m.ristorante_id) {
        return res.status(400).json({ error: `ristorante_id mancante per il piatto: ${m.nome}` });
      }

      const ristoranteIdObject = new ObjectId(m.ristorante_id);
      ordiniPerRistoranti[ristoranteIdObject] = ordiniPerRistoranti[ristoranteIdObject] || [];
      ordiniPerRistoranti[ristoranteIdObject].push({
        _id: new ObjectId(m._id),
        nome: m.nome,
        quantita: m.quantita,
        prezzo_unitario: m.prezzo_unitario,
        tempo_preparazione: m.tempo_preparazione || 10 
      });
    }

    await Promise.all(Object.keys(ordiniPerRistoranti).map(async ristoranteId => {
      let totale = 0;
      let tempoAttesa = 0;

      ordiniPerRistoranti[ristoranteId].forEach(meal => {
        totale += meal.quantita * meal.prezzo_unitario;
        tempoAttesa += meal.quantita * meal.tempo_preparazione;
      });

      const utente = await db.collection("users").findOne({_id: new ObjectId(user._id)});
      const ordiniRistorante = await db.collection("orders").find({ ristorante_id: new ObjectId(ristoranteId), stato: { $ne: "consegnato" } }).toArray();

      //ordine va direttamente in preparazione se è il primo della coda del ristorante
      let stato = ordiniRistorante.length === 0 ? "in preparazione" : "ordinato";

      ordiniRistorante.forEach(o => {
        if (["in preparazione", "ordinato"].includes(o.stato)) {
          tempoAttesa += o.tempo_attesa;
        }
      });

      const newOrder = {
        cliente_id: new ObjectId(utente._id),
        cliente_nome: utente.username,
        ristorante_id: new ObjectId(ristoranteId),
        meals: ordiniPerRistoranti[ristoranteId],
        totale,
        stato,
        data_ordine: DateTime.now().setZone("Europe/Rome").toFormat("dd/MM/yyyy - HH:mm"),
        metodo_consegna: metodo_consegna,
        tempo_attesa: tempoAttesa
      };

      await db.collection("orders").insertOne(newOrder);
    }));

    res.status(201).json({ message: "Ordini creati con successo." });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore nella creazione dell'ordine" });
  }
});


// PUT /orders/:id - Modifica stato ordine (Richiede autenticazione ristoratore)
ordersRouter.put("/:id", authenticateUser, authorizeRistoratore, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const user = req.user;
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "ID ordine non valido" });
    }

    if (user.role !== "ristoratore") {
      return res.status(403).json({ error: "Solo i ristoratori possono modificare lo stato" });
    }

    const ristorante = await db.collection("restaurants").findOne({ ristoratore_id: new ObjectId(user._id) });
    if (!ristorante) return res.status(404).json({ error: "Ristorante non trovato" });

    const order = await db.collection("orders").findOne({ _id: new ObjectId(id) });
    if (!order) return res.status(404).json({ error: "Ordine non trovato" });

    if (order.ristorante_id.toString() !== ristorante._id.toString()) {
      return res.status(403).json({ error: "Non puoi modificare ordini di altri ristoranti" });
    }

    const currentStateIndex = validStates.indexOf(order.stato);
    console.log(currentStateIndex)
    console.log(order.metodo_consegna)
    if (order.metodo_consegna == "Ritiro in ristorante") {
      if (currentStateIndex == 3) {
        return res.status(400).json({ error: "Ordine già consegnato" });
      }
      const nuovoStato = currentStateIndex == 1 ? validStates[currentStateIndex + 2] : validStates[currentStateIndex + 1]; 
      await db.collection("orders").updateOne({ _id: new ObjectId(id) }, { $set: { stato: nuovoStato } });
    }
    else {
      if (currentStateIndex >= 2) {
        return res.status(400).json({ error: "Solo il cliente può confermare la ricezione" });
      }
      const nuovoStato = validStates[currentStateIndex + 1]; 
      await db.collection("orders").updateOne({ _id: new ObjectId(id) }, { $set: { stato: nuovoStato } });
    }

    res.json({ message: "Stato ordine aggiornato correttamente." });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore nell'aggiornamento ordine" });
  }
});

// GET /orders - Lista ordini (Cliente solo propri, Ristoratore solo quelli relativi al suo ristorante)
ordersRouter.get("/", authenticateUser, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const user = req.user;

    let filter = {};
    if (user.role === "cliente") {
      filter.cliente_id = new ObjectId(user._id);
    } else if (user.role === "ristoratore") {
      const ristorante = await db.collection("restaurants").findOne({ ristoratore_id: new ObjectId(user._id) });
      if (!ristorante) return res.status(404).json({ error: "Ristorante non trovato" });

      filter.ristorante_id = new ObjectId(ristorante._id);
    } else {
      return res.status(403).json({ error: "Accesso negato" });
    }

    const orders = await db.collection("orders").find(filter).toArray();

    for (const order of orders) {
      const ristorante = await db.collection("restaurants").findOne({ _id: order.ristorante_id });
      order.ristorante_nome = ristorante ? ristorante.name : "Ristorante Sconosciuto";
    }

    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore nel recupero ordini" });
  }
});


// GET /orders/:id - Dettagli singolo ordine (Cliente solo propri, Ristoratore solo quelli relativi al suo ristorante)
ordersRouter.get("/:id", authenticateUser, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const user = req.user;
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "ID ordine non valido" });
    }

    const order = await db.collection("orders").findOne({ _id: new ObjectId(id) });

    if (!order) return res.status(404).json({ error: "Ordine non trovato" });

    if ((user.role === "cliente" && order.cliente_id.toString() !== user._id) &&(user.role === "ristoratore" && order.ristorante_id.toString() !== user._id)) {
      return res.status(403).json({ error: "Accesso negato all'ordine" });
    }

    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore nel recupero ordine" });
  }
});


// PUT /orders/:id/consegna - Conferma consegna da parte del cliente (per ordini con consegna a domicilio)
ordersRouter.put("/:id/consegna", authenticateUser, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const user = req.user;
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "ID ordine non valido" });
    }

    if (user.role !== "cliente") {
      return res.status(403).json({ error: "Solo i clienti possono confermare la consegna" });
    }

    const order = await db.collection("orders").findOne({ _id: new ObjectId(id) });

    if (!order) return res.status(404).json({ error: "Ordine non trovato" });
    if (order.cliente_id.toString() !== user._id) {
      return res.status(403).json({ error: "Non puoi modificare ordini di altri clienti" });
    }

    if (order.stato !== "in consegna") {
      return res.status(400).json({ error: "Puoi confermare la consegna solo se l'ordine è 'in consegna'" });
    }

    const result = await db.collection("orders").findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { stato: "consegnato" } },
      { returnDocument: "after" }
    );

    res.json(result.value);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore nella conferma consegna" });
  }
});


export default ordersRouter;
