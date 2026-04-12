const Datacenter = require('../models/Datacenter');
const Rack = require('../models/Rack');
const Server = require('../models/Server');
const Switch = require('../models/Switch');
const StorageBay = require('../models/StorageBay');
const DataDomain = require('../models/DataDomain');
const { successResponse, errorResponse } = require('../utils/apiResponse');

// GET /api/dashboard
const getDashboardStats = async (req, res) => {
  try {
    const [
      totalDatacenters,
      totalRacks,
      totalServers,
      totalSwitches,
      totalStorage,
      totalDataDomains,
      serversByRole,
      recentServers
    ] = await Promise.all([
      Datacenter.countDocuments(),
      Rack.countDocuments(),
      Server.countDocuments(),
      Switch.countDocuments(),
      StorageBay.countDocuments(),
      DataDomain.countDocuments(),
      Server.aggregate([
        { $group: { _id: '$role', count: { $sum: 1 } } }
      ]),
      Server.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('datacenter', 'name code')
        .populate('rack', 'name')
        .select('name brand model role createdAt')
    ]);

    return successResponse(res, {
      counts: {
        datacenters: totalDatacenters,
        racks: totalRacks,
        servers: totalServers,
        switches: totalSwitches,
        storage: totalStorage,
        dataDomains: totalDataDomains
      },
      serversByRole,
      recentServers
    });
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// GET /api/dashboard/capacity
const getCapacityStats = async (req, res) => {
  try {
    const [rackCapacityByDatacenter, storageCapacityByDatacenter, dataDomainCapacityByDatacenter] = await Promise.all([
      Rack.aggregate([
        {
          $group: {
            _id: '$datacenter',
            totalRacks: { $sum: 1 },
            totalU: { $sum: '$totalU' },
            occupiedU: { $sum: '$occupiedU' },
            maxPowerW: { $sum: '$maxPowerConsumption' },
            currentPowerW: { $sum: '$currentPowerConsumption' }
          }
        },
        {
          $lookup: {
            from: 'datacenters',
            localField: '_id',
            foreignField: '_id',
            as: 'datacenter'
          }
        },
        { $unwind: { path: '$datacenter', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            datacenterId: '$_id',
            datacenterName: '$datacenter.name',
            datacenterCode: '$datacenter.code',
            totalRacks: 1,
            totalU: 1,
            occupiedU: 1,
            freeU: { $max: [{ $subtract: ['$totalU', '$occupiedU'] }, 0] },
            occupancyPct: {
              $cond: [{ $gt: ['$totalU', 0] }, { $multiply: [{ $divide: ['$occupiedU', '$totalU'] }, 100] }, 0]
            },
            maxPowerW: 1,
            currentPowerW: 1
          }
        },
        { $sort: { datacenterCode: 1, datacenterName: 1 } }
      ]),
      StorageBay.aggregate([
        {
          $group: {
            _id: '$datacenter',
            totalCapacityTB: { $sum: '$totalCapacityTB' },
            allocatedCapacityTB: { $sum: '$allocatedCapacityTB' }
          }
        },
        {
          $project: {
            _id: 0,
            datacenterId: '$_id',
            totalCapacityTB: 1,
            allocatedCapacityTB: 1,
            freeCapacityTB: { $max: [{ $subtract: ['$totalCapacityTB', '$allocatedCapacityTB'] }, 0] }
          }
        }
      ]),
      DataDomain.aggregate([
        {
          $group: {
            _id: '$datacenter',
            totalCapacityTB: { $sum: '$totalCapacityTB' },
            usedCapacityTB: { $sum: '$usedCapacityTB' }
          }
        },
        {
          $project: {
            _id: 0,
            datacenterId: '$_id',
            totalCapacityTB: 1,
            usedCapacityTB: 1,
            freeCapacityTB: { $max: [{ $subtract: ['$totalCapacityTB', '$usedCapacityTB'] }, 0] }
          }
        }
      ])
    ]);

    const storageMap = new Map(storageCapacityByDatacenter.map((x) => [String(x.datacenterId || ''), x]));
    const ddMap = new Map(dataDomainCapacityByDatacenter.map((x) => [String(x.datacenterId || ''), x]));

    const byDatacenter = rackCapacityByDatacenter.map((rack) => {
      const key = String(rack.datacenterId || '');
      const storage = storageMap.get(key) || {
        totalCapacityTB: 0,
        allocatedCapacityTB: 0,
        freeCapacityTB: 0
      };
      const dataDomain = ddMap.get(key) || {
        totalCapacityTB: 0,
        usedCapacityTB: 0,
        freeCapacityTB: 0
      };

      return {
        ...rack,
        storage,
        dataDomain
      };
    });

    return successResponse(res, {
      byDatacenter,
      totals: {
        totalU: byDatacenter.reduce((sum, d) => sum + (d.totalU || 0), 0),
        occupiedU: byDatacenter.reduce((sum, d) => sum + (d.occupiedU || 0), 0),
        storageTotalTB: byDatacenter.reduce((sum, d) => sum + (d.storage?.totalCapacityTB || 0), 0),
        storageAllocatedTB: byDatacenter.reduce((sum, d) => sum + (d.storage?.allocatedCapacityTB || 0), 0),
        dataDomainTotalTB: byDatacenter.reduce((sum, d) => sum + (d.dataDomain?.totalCapacityTB || 0), 0),
        dataDomainUsedTB: byDatacenter.reduce((sum, d) => sum + (d.dataDomain?.usedCapacityTB || 0), 0)
      }
    });
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

module.exports = { getDashboardStats, getCapacityStats };