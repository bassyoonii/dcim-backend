const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    actorName: {
      type: String,
      trim: true,
      default: null
    },
    action: {
      type: String,
      enum: ['CREATE', 'UPDATE', 'DELETE', 'ALERT'],
      required: true,
      index: true
    },
    entity: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true
    },
    entityLabel: {
      type: String,
      trim: true,
      default: null
    },
    readAt: {
      type: Date,
      default: null,
      index: true
    }
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
