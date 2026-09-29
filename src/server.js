const app = require('./app');
require('dotenv').config();

const port = Number(process.env.PORT || 3000);

app.listen(port, '0.0.0.0', () => {
  console.log(`Meterly API listening on port ${port}`);
});
