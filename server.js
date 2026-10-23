const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const apiRouter = require('./server/routes/api');
const app = express();
const PORT = process.env.PORT || 3000;

if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api', apiRouter);

app.use('/vendor/chart.js', express.static(path.join(__dirname, 'node_modules', 'chart.js', 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`SahayakAI running on http://localhost:${PORT}`);
  console.log(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
    ? 'Supabase Auth and persistence are configured.'
    : 'Demo mode is active. Configure Supabase to enable private persistent accounts and history.');
});
