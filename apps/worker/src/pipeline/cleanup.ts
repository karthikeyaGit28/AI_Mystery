import {
  AssetModel,
  CaseModel,
  EventModel,
  GuestModel,
  IdempotencyModel,
  ProgressModel,
  SecretModel,
  cleanupQueue,
  config,
  storage,
} from '@amr/server';

export async function cleanupCase(caseId: string) {
  const record = await CaseModel.findById(caseId).lean();
  if (record && !record.deletedAt && new Date(record.expiresAt).getTime() > Date.now()) return;
  const assets = await AssetModel.find({ caseId }).lean();
  for (const asset of assets) await storage.deleteObject(asset.objectKey);
  // Delete records only after object deletion succeeds; repeated cleanup is safe.
  await Promise.all([
    AssetModel.deleteMany({ caseId }),
    SecretModel.deleteMany({ caseId }),
    ProgressModel.deleteMany({ caseId }),
    EventModel.deleteMany({ caseId }),
    IdempotencyModel.deleteMany({
      $or: [{ 'response.caseId': caseId }, { scope: { $regex: caseId } }],
    }),
  ]);
  await CaseModel.deleteOne({ _id: caseId });
  await GuestModel.updateOne(
    { activeGenerationCaseId: caseId },
    { $set: { activeGenerationCaseId: null } },
  );
}

export async function maintenanceSweep() {
  const stale = await CaseModel.find({
    deletedAt: null,
    status: { $nin: ['READY', 'FAILED'] },
    updatedAt: { $lt: new Date(Date.now() - config.GENERATION_WATCHDOG_MINUTES * 60_000) },
  })
    .select('_id')
    .lean();
  for (const record of stale) {
    await CaseModel.updateOne(
      { _id: record._id, status: { $nin: ['READY', 'FAILED'] } },
      { $set: { status: 'FAILED', failureCode: 'GENERATION_TIMEOUT' } },
    );
    await GuestModel.updateOne(
      { activeGenerationCaseId: record._id },
      { $set: { activeGenerationCaseId: null } },
    );
  }
  const expired = await CaseModel.find({
    $or: [{ deletedAt: { $ne: null } }, { expiresAt: { $lte: new Date() } }],
  })
    .select('_id')
    .limit(100)
    .lean();
  for (const record of expired) {
    await CaseModel.updateOne(
      { _id: record._id, deletedAt: null },
      { $set: { deletedAt: new Date() } },
    );
    const jobId = `cleanup-${record._id}`;
    const prior = await cleanupQueue.getJob(jobId);
    if (!prior)
      await cleanupQueue.add(
        'cleanup',
        { caseId: record._id },
        {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
  }
}
