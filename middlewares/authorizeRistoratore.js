const authorizeRistoratore = (req, res, next) => {
    if (req.user.role !== "ristoratore") {
      return res.status(403).json({ error: "Accesso consentito solo ai ristoratori" });
    }
    next();
  };
  
  export default authorizeRistoratore;
  