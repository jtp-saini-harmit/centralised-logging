import { S3Client, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: process.env.AWS_REGION });

export const handler = async (event) => {
    for (const record of event.Records) {
        const bucket = record.s3.bucket.name; // Source bucket
        const oldKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' ')); // Old key

        const timestamp = new Date().toISOString().replace(/[:.-]/g, ''); // Remove special characters from timestamp
        const newKey = `renamed-logs/renamed-${timestamp}.gz`; // New key

        try {
            // Copy the object to a new location
            await s3.send(new CopyObjectCommand({
                Bucket: bucket,
                CopySource: `${bucket}/${oldKey}`,
                Key: newKey,
                MetadataDirective: 'REPLACE'
            }));

            
            console.log(`Copied ${oldKey} to ${newKey}`);
            
            // Delete the original object after the copy succeeds
            await s3.send(new DeleteObjectCommand({
                Bucket: bucket,
                Key: oldKey
            }));

            console.log(`Deleted ${oldKey}`);

        } catch (error) {
            console.error(`Error processing ${oldKey}:`, error);
            throw new Error(`Error processing ${oldKey}: ${error.message}`);
        }
    }
};
