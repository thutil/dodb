import app from "./app";

const PORT = process.env.PORT || 5820;

app.listen(PORT, () => {
  console.log(`Database management API listening on port ${PORT}`);
});