require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const app = express();

app.use(cors());
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Territory Backend Running");
});

app.use('/api/auth', require('./modules/auth/auth.routes'));
app.use('/api/activities', require('./modules/activity/activity.routes'));
app.use('/api/territories', require('./modules/activity/territory.routes'));


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});