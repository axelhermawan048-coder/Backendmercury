const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// 1. KONEKSI MONGODB ATLAS
const MONGO_URI = "mongodb+srv://axelhermawan048_db_user:yz2NXgwKHfdJGapG@cluster0.ebe9r6p.mongodb.net/myDatabase?retryWrites=true&w=majority"; 

let isConnected = false;

const connectDB = async () => {
  if (isConnected && mongoose.connection.readyState === 1) {
    return;
  }
  try {
    const db = await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      bufferCommands: false
    });
    isConnected = db.connections[0].readyState === 1;
    console.log('MongoDB Atlas Connected...');
  } catch (err) {
    console.error('MongoDB Connection Error:', err);
    throw err;
  }
};

app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(500).json({ error: 'Gagal terhubung ke database MongoDB' });
  }
});

// 2. SCHEMA & MODEL
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 0, min: 0 },
  kycStatus: { type: String, default: 'Belum Verifikasi' },
  bankInfo: {
    bankName: { type: String, default: '' },
    accNumber: { type: String, default: '' },
    holderName: { type: String, default: '' }
  }
}, { timestamps: true });

const transactionSchema = new mongoose.Schema({
  trxId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  type: { type: String, enum: ['Deposit', 'Withdraw'], required: true },
  amount: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ['Pending', 'Berhasil', 'Ditolak'], default: 'Pending' },
  bankDetails: String
}, { timestamps: true });

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);

// 3. API ENDPOINTS

// --- USER AUTHENTICATION ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Semua field harus diisi!' });
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email sudah terdaftar!' });

    const userId = '#USR-' + Math.floor(1000 + Math.random() * 9000);
    const user = await User.create({ userId, name, email, password, balance: 0 });
    
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(201).json({ message: 'Registrasi berhasil', user: userResponse });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (!user) return res.status(401).json({ message: 'Email atau kata sandi salah' });

    const userResponse = user.toObject();
    delete userResponse.password;

    res.json({ message: 'Login berhasil', user: userResponse });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET USER (Dukungan validasi ObjectId & userId)
app.get('/api/users/:userId', async (req, res) => {
  try {
    const param = req.params.userId;
    
    let query;
    if (param.startsWith('#USR-')) {
      query = { userId: param };
    } else if (mongoose.Types.ObjectId.isValid(param)) {
      query = { _id: param };
    } else {
      return res.status(400).json({ message: 'Format ID tidak valid' });
    }

    const user = await User.findOne(query).select('-password');
    if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });
    
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Rekening Bank User
app.put('/api/users/:userId/bank', async (req, res) => {
  try {
    const { bankName, accNumber, holderName } = req.body;
    const param = req.params.userId;
    const query = param.startsWith('#USR-') ? { userId: param } : mongoose.Types.ObjectId.isValid(param) ? { _id: param } : null;

    if (!query) return res.status(400).json({ message: 'Format ID tidak valid' });

    const user = await User.findOneAndUpdate(
      query,
      { bankInfo: { bankName, accNumber, holderName } },
      { new: true }
    ).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Status KYC User
app.put('/api/users/:userId/kyc', async (req, res) => {
  try {
    const param = req.params.userId;
    const query = param.startsWith('#USR-') ? { userId: param } : mongoose.Types.ObjectId.isValid(param) ? { _id: param } : null;

    if (!query) return res.status(400).json({ message: 'Format ID tidak valid' });

    const user = await User.findOneAndUpdate(
      query,
      { kycStatus: 'Menunggu Verifikasi' },
      { new: true }
    ).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- TRANSAKSI USER ---
app.post('/api/transactions', async (req, res) => {
  try {
    const { userId, userName, type, amount, bankDetails } = req.body;
    
    if (amount <= 0) {
      return res.status(400).json({ message: 'Jumlah transaksi harus lebih dari 0' });
    }

    if (type === 'Withdraw') {
      const query = userId.startsWith('#USR-') ? { userId } : mongoose.Types.ObjectId.isValid(userId) ? { _id: userId } : null;
      if (!query) return res.status(400).json({ message: 'Format ID tidak valid' });

      const user = await User.findOne(query);
      if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });
      if (user.balance < amount) {
        return res.status(400).json({ message: 'Saldo tidak mencukupi untuk penarikan' });
      }
    }

    const trxId = '#' + (type === 'Deposit' ? 'DEP-' : 'WD-') + Math.floor(10000 + Math.random() * 90000);
    
    const newTrx = await Transaction.create({
      trxId, userId, userName, type, amount, bankDetails
    });

    res.status(201).json(newTrx);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/transactions/user/:userId', async (req, res) => {
  try {
    const history = await Transaction.find({ userId: req.params.userId }).sort({ createdAt: -1 });
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API ADMIN ---
app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/users/:userId/balance', async (req, res) => {
  try {
    const { balance } = req.body;
    if (balance < 0) return res.status(400).json({ message: 'Saldo tidak boleh negatif' });

    const param = req.params.userId;
    const query = param.startsWith('#USR-') ? { userId: param } : mongoose.Types.ObjectId.isValid(param) ? { _id: param } : null;

    if (!query) return res.status(400).json({ message: 'Format ID tidak valid' });

    const user = await User.findOneAndUpdate(
      query,
      { balance },
      { new: true }
    ).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/transactions', async (req, res) => {
  try {
    const trxs = await Transaction.find().sort({ createdAt: -1 });
    res.json(trxs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/transactions/:trxId/status', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { status } = req.body;
    const trx = await Transaction.findOne({ trxId: req.params.trxId }).session(session);
    
    if (!trx) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Transaksi tidak ditemukan' });
    }

    if (trx.status === 'Berhasil' || trx.status === 'Ditolak') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: `Transaksi sudah berstatus ${trx.status}` });
    }

    if (status === 'Berhasil') {
      const userQuery = trx.userId.startsWith('#USR-') ? { userId: trx.userId } : mongoose.Types.ObjectId.isValid(trx.userId) ? { _id: trx.userId } : null;
      const user = await User.findOne(userQuery).session(session);
      if (!user) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: 'User transaksi tidak ditemukan' });
      }

      if (trx.type === 'Deposit') {
        user.balance += trx.amount;
      } else if (trx.type === 'Withdraw') {
        if (user.balance < trx.amount) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ message: 'Gagal konfirmasi: Saldo user kurang dari jumlah penarikan' });
        }
        user.balance -= trx.amount;
      }
      await user.save({ session });
    }

    trx.status = status;
    await trx.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.json(trx);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`Backend Server running on port ${PORT}`));
}
