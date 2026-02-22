import express from "express";

const router = express.Router();

router.get("/", (req, res) => {
  res.status(200).send({ response: "Server is up and running." });
});

export default router;