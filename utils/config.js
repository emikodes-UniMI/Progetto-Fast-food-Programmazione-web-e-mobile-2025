import dotenv from "dotenv";
/*dotenv è un modulo che permette il caricamento di variabili d'ambiente da un file .env
Le variabili d'ambiente vengono memorizzate nell'oggetto globale process.env in Node.js*/

dotenv.config(); //estrae i valori dal file .env, e li carica nelle variabili d'ambiente process.env

const config = {
  PORT: process.env.PORT,
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
};

export default config;
