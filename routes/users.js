import express from "express";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import authenticateUser from "../middlewares/authenticateUser.js";

const usersRouter = express.Router();

// POST /users/register - Registrazione utente (cliente o ristoratore)
usersRouter.post("/register", async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { username, email, password, numero_di_telefono, indirizzo = "", metodo_pagamento = "", piva = "", role } = req.body;

    if (!username || !email || !password || !numero_di_telefono) {
      return res.status(400).json({ error: "username, email, password e numero di telefono sono obbligatori" });
    }

    if(role=="cliente" && (!indirizzo || !metodo_pagamento)){
      return res.status(400).json({ error: "Indirizzo e metodo di pagamento sono obbligatori" });
    }

    if(role=="ristoratore" && !piva){
      return res.status(400).json({ error: "Partita IVA obbligatoria" });
    }

    const userExists = await db.collection("users").findOne({
      $or: [{ username }, { email }],
    });

    if (userExists) {
      return res.status(409).json({ error: "Username o email già in uso" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    let newUser={};

    if(role=="ristoratore"){
      newUser = {
        username,
        email,
        password: hashedPassword,
        numero_di_telefono,
        piva: piva,
        role
      };
    }else{
      newUser = {
        username,
        email,
        password: hashedPassword,
        numero_di_telefono,
        indirizzo,
        metodo_pagamento,
        role,
      };
    }

    const result = await db.collection("users").insertOne(newUser);
    res.status(201).json({ message: "Utente registrato con successo", userId: result.insertedId });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore nella registrazione" });
  }
});

// POST /users/login - login
usersRouter.post("/login", async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "username e password sono obbligatori" });
    }

    const user = await db.collection("users").findOne({ username });
    if (!user) {
      return res.status(401).json({ error: "Credenziali non valide" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Credenziali non valide" });
    }

    // genera JWT con userId e role, codificato in base alla chiave memorizzata nel file .env
    const token = jwt.sign(
      { userId: user._id.toString(), role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore nel login" });
  }
});

// GET /users/me - Restituisce informazioni relative all'utente autenticato
usersRouter.get("/me", authenticateUser, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const userId = req.user._id;

    const user = await db.collection("users").findOne(
      { _id: new ObjectId(userId) },
      { projection: { password: 0 } }
    );

    if (!user) return res.status(404).json({ error: "Utente non trovato" });

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore nel recupero utente" });
  }
});

// PUT /users/me - Modifica dati profilo utente autenticato (passsword esclusa)
usersRouter.put("/me", authenticateUser, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const userId = req.user._id;

    // impedisce inserimento nuova mail o username, se non è univoco per il db.
    if (req.body.email || req.body.username) {
      const query = {
        $or: [],
        _id: { $ne: new ObjectId(userId) },
      };
      if (req.body.email) query.$or.push({ email: req.body.email });
      if (req.body.username) query.$or.push({ username: req.body.username });

      if (query.$or.length > 0) {
        const exists = await db.collection("users").findOne(query);
        if (exists) {
          return res.status(409).json({ error: "Username o email già in uso" });
        }
      }
    }
    const result = await db.collection("users").findOneAndUpdate(
      { _id: new ObjectId(userId) },
      { $set: req.body },
      { returnDocument: "after", projection: { password: 0 } }
    );
    console.log(result)

    if (!result) return res.status(404).json({ error: "Utente non trovato" });

    res.json(result.value);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore nell'aggiornamento utente" });
  }
});

// PUT /users/me/password - Modifica password utente autenticato
usersRouter.put("/me/password", authenticateUser, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const userId = req.user._id;
    const { oldPassword, newPassword } = req.body;
    
    const user = await db.collection("users").findOne({ _id: new ObjectId(userId) });
    if (!user) return res.status(404).json({ error: "Utente non trovato" });

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: "Errore durante l'analisi dei parametri" });
    }

    const passwordMatch = await bcrypt.compare(oldPassword,user.password);
    if(!passwordMatch){
      return res.status(400).json({ error: "La Vecchia password non corrisponde col valore indicato." });

    }

    const hashedNewPassword = await bcrypt.hash(newPassword,10);
    await db.collection("users").updateOne(
      { _id: new ObjectId(userId) },
      { $set: { password: hashedNewPassword} }
    );

    res.json({ message: "Password aggiornata con successo" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore nell'aggiornamento password" });
  }
});

//DELETE /:id - Elimina utente autenticato:
//Se l'utente è un cliente, vengono eliminati anche il carrello e tutti gli ordini ancora attivi (quelli già consegnati, rimangono nel DB per statistiche ristorante)
//Se l'utente è un ristoratore, vengono eliminati anche il suo ristorante, e tutti gli ordini di quel ristorante.
usersRouter.delete("/:id", authenticateUser, async (req, res) => {
  const db = req.app.locals.db;
  const userId = req.params.id;

  if (!ObjectId.isValid(userId)) {
    return res.status(400).json({ error: "ID utente non valido" });
  }

  if (req.user._id.toString() !== userId.toString()) {
    return res.status(403).json({ error: "Non puoi eliminare un altro utente" });
  }

  try {
    if (req.user.role === "cliente") {
      await db.collection("carts").deleteOne({ user_id: new ObjectId(userId) });
      await db.collection("orders").deleteMany({
        cliente_id: new ObjectId(userId),
        stato: { $ne: "consegnato" }
      });
          }

    if (req.user.role === "ristoratore") {
      const restaurant = await db.collection("restaurants").findOne({ ristoratore_id: new ObjectId(userId) });
      if (restaurant) {
        await db.collection("orders").deleteMany({ ristorante_id: new ObjectId(restaurant._id) });
        await db.collection("restaurants").deleteOne({ _id: new ObjectId(restaurant._id) });
      }
    }

    await db.collection("users").deleteOne({ _id: new ObjectId(userId) });

    res.json({ message: "Utente eliminato correttamente e dati associati rimossi." });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore durante l'eliminazione dell'utente" });
  }
});
export default usersRouter;
