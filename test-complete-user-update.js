require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');

const API_BASE = 'http://localhost:5000/api';

async function testUserUpdateFlow() {
  console.log('🧪 TEST COMPLET FLOW MISE À JOUR UTILISATEUR\n');

  let token = null;

  try {
    // 1. Connexion à la DB pour vérifier directement
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté à MongoDB');

    const User = require('./models/User');

    // 2. Trouver un admin pour l'authentification
    const adminUser = await User.findOne({ role: 'admin' });
    if (!adminUser) {
      console.log('❌ Aucun admin trouvé pour l\'authentification');
      return;
    }

    console.log('👑 Admin trouvé:', adminUser.email);

    // 3. Authentification pour obtenir le token
    console.log('\n🔐 Authentification...');
    try {
      const authResponse = await axios.post(`${API_BASE}/auth/login`, {
        email: adminUser.email,
        password: 'admin123' // Mot de passe par défaut
      });
      token = authResponse.data.data.token;
      console.log('✅ Token obtenu');
    } catch (error) {
      console.log('❌ Authentification échouée:', error.response?.data || error.message);
      return;
    }

    // Headers pour les requêtes authentifiées
    const headers = { Authorization: `Bearer ${token}` };

    // 4. Trouver un utilisateur à modifier (pas l'admin)
    const users = await User.find({ _id: { $ne: adminUser._id } }).limit(1);
    if (users.length === 0) {
      console.log('❌ Aucun utilisateur non-admin trouvé pour le test');
      return;
    }

    const user = users[0];
    const userId = user._id.toString();
    console.log('👤 Utilisateur de test:', {
      id: userId,
      name: user.name,
      email: user.email,
      role: user.role
    });

    // 5. Test de l'API GET pour récupérer l'utilisateur
    console.log('\n🔍 Test API GET /users/:id');
    try {
      const getResponse = await axios.get(`${API_BASE}/users/${userId}`, { headers });
      console.log('✅ GET réussi:', getResponse.data.data.email);
    } catch (error) {
      console.log('❌ GET échoué:', error.response?.data || error.message);
    }

    // 6. Test de l'API PUT pour mettre à jour
    const originalEmail = user.email;
    const newEmail = `test-${Date.now()}@example.com`;

    console.log('\n🔄 Test API PUT /users/:id');
    console.log('- Ancien email:', originalEmail);
    console.log('- Nouvel email:', newEmail);

    try {
      const putResponse = await axios.put(`${API_BASE}/users/${userId}`, {
        name: user.name,
        email: newEmail,
        role: user.role,
        isActive: user.isActive
      }, { headers });
      console.log('✅ PUT réussi:', putResponse.data.data.email);
    } catch (error) {
      console.log('❌ PUT échoué:', error.response?.data || error.message);
      return;
    }

    // 7. Vérifier en DB que la mise à jour a été faite
    console.log('\n💾 Vérification en base de données');
    const updatedUser = await User.findById(userId);
    if (updatedUser.email === newEmail) {
      console.log('✅ DB mise à jour:', updatedUser.email);
    } else {
      console.log('❌ DB non mise à jour:', updatedUser.email);
    }

    // 8. Test de l'API GET all users pour voir si la liste est à jour
    console.log('\n📋 Test API GET /users (liste)');
    try {
      const listResponse = await axios.get(`${API_BASE}/users`, { headers });
      const userInList = listResponse.data.data.find(u => u._id === userId);
      if (userInList && userInList.email === newEmail) {
        console.log('✅ Liste à jour:', userInList.email);
      } else {
        console.log('❌ Liste pas à jour:', userInList?.email || 'utilisateur non trouvé');
      }
    } catch (error) {
      console.log('❌ GET liste échoué:', error.response?.data || error.message);
    }

    // 9. Nettoyer - remettre l'ancien email
    console.log('\n🧹 Nettoyage - remise de l\'email original');
    await User.findByIdAndUpdate(userId, { email: originalEmail });
    console.log('✅ Email remis à l\'original');

  } catch (error) {
    console.error('\n💥 ERREUR GÉNÉRALE:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

testUserUpdateFlow();