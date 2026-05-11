require('dotenv').config();
const mongoose = require('mongoose');

async function testUserUpdate() {
  console.log('🧪 TEST MISE À JOUR UTILISATEUR\n');

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté à MongoDB');

    const User = require('./models/User');

    // Trouver un utilisateur existant
    const users = await User.find().limit(1);
    if (users.length === 0) {
      console.log('❌ Aucun utilisateur trouvé pour le test');
      return;
    }

    const user = users[0];
    console.log('👤 Utilisateur de test:', {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role
    });

    // Tester la mise à jour
    const originalEmail = user.email;
    const newEmail = `test-${Date.now()}@example.com`;

    console.log('\n🔄 Test de mise à jour...');
    console.log('- Ancien email:', originalEmail);
    console.log('- Nouvel email:', newEmail);

    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      {
        name: user.name,
        email: newEmail,
        role: user.role,
        isActive: user.isActive
      },
      { new: true, runValidators: true }
    ).select('-password');

    if (updatedUser) {
      console.log('\n✅ MISE À JOUR RÉUSSIE:');
      console.log('- ID:', updatedUser._id);
      console.log('- Nom:', updatedUser.name);
      console.log('- Email mis à jour:', updatedUser.email);
      console.log('- Rôle:', updatedUser.role);
      console.log('- Actif:', updatedUser.isActive);

      // Remettre l'ancien email
      await User.findByIdAndUpdate(user._id, { email: originalEmail });
      console.log('\n🔄 Email remis à l\'original pour nettoyer le test');
    } else {
      console.log('\n❌ ÉCHEC: Utilisateur non trouvé après mise à jour');
    }

  } catch (error) {
    console.error('\n💥 ERREUR lors du test:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

testUserUpdate();