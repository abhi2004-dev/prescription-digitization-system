import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as FileSystemRoot from 'expo-file-system';
import { Alert, Platform } from 'react-native';

const FileSystem = (FileSystemLegacy && FileSystemLegacy.copyAsync) ? FileSystemLegacy : FileSystemRoot;

/**
 * Builds a beautiful, professional medical clinical report HTML template.
 */
export function generatePrescriptionHTML(data) {
  const patientDetails = data?.patient_details || {};
  const patientName = data?.patient_name || patientDetails?.name || 'Not Specified';
  const patientAge = data?.patient_age || patientDetails?.age || 'N/A';
  const patientSex = data?.patient_sex || patientDetails?.sex || 'N/A';

  const doctorName = data?.doctor_name ? `Dr. ${data.doctor_name.replace(/^dr\.?\s*/i, '')}` : 'Licensed Medical Practitioner';
  const hospitalName = data?.hospital_name || 'Medical Health Center / Clinic';
  const licenseCode = data?.license_code || data?.doctor_license_number || data?.doctor_id || 'REG-PENDING';
  
  const verification = data?.verification || {};
  const licenseStatus = verification?.license_status || (data?.doctor_license_validated ? 'Valid' : 'Verified');
  const isLicenseValid = licenseStatus === 'Valid' || licenseStatus === 'Verified';
  const signaturePresent = verification?.signature_present !== undefined 
    ? Boolean(verification.signature_present) 
    : Boolean(data?.signature_verified || data?.sign_present);

  const medicines = data?.medicines || data?.prescribed_medications || [];
  const validMedicines = medicines.filter(m => m && (m.drug_name || m.name || m.drug));

  const advice = data?.doctor_suggestions || data?.doctor_advice || data?.advice || [];
  const diseases = data?.diseases_identified || [];
  const interactions = data?.interactions || data?.warnings || [];
  const isOwner = data?.is_owner === true;

  const dateStr = data?.date_scanned || data?.created_at 
    ? new Date(data.date_scanned || data.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

  const rxRows = validMedicines.length > 0 ? validMedicines.map((med, idx) => {
    const name = med.drug_name || med.name || med.drug || 'Medication';
    const strength = med.strength || med.dosage || '-';
    const form = med.form || 'Tablet';
    const frequency = med.frequency || med.schedule_text || med.schedule || 'As directed';
    const instructions = med.instructions || med.timing || 'Take as advised by doctor';
    const duration = med.duration ? `<span class="duration-badge">${med.duration}</span>` : '';

    return `
      <tr>
        <td class="col-idx">${idx + 1}</td>
        <td class="col-drug">
          <div class="drug-name">${name}</div>
          <div class="drug-form-strength">${form} &bull; ${strength}</div>
        </td>
        <td class="col-freq">
          <span class="freq-badge">${frequency}</span>
        </td>
        <td class="col-inst">
          <div>${instructions}</div>
          ${duration}
        </td>
      </tr>
    `;
  }).join('') : `
    <tr>
      <td colspan="4" class="no-meds">No medications detected on this prescription slip.</td>
    </tr>
  `;

  const adviceHtml = advice.length > 0 ? `
    <div class="section-card advice-card">
      <div class="section-header">
        <span class="section-title">PHYSICIAN'S CLINICAL ADVICE & LIFESTYLE INSTRUCTIONS</span>
      </div>
      <ul class="advice-list">
        ${advice.map(a => `<li>${a}</li>`).join('')}
      </ul>
    </div>
  ` : '';

  const interactionsHtml = interactions.length > 0 ? `
    <div class="section-card warning-card">
      <div class="section-header alert-header">
        <span class="section-title alert-title">&#9888; CLINICAL DRUG INTERACTION ALERTS (${interactions.length})</span>
      </div>
      <div class="interaction-items">
        ${interactions.map(item => `
          <div class="interaction-row">
            <div class="interaction-pair"><strong>${item.drug_1 || 'Drug A'}</strong> &harr; <strong>${item.drug_2 || 'Drug B'}</strong></div>
            <div class="interaction-desc">${item.description || item.message || 'Potential interaction risk.'}</div>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <title>Medical Prescription Report - PrescriptoAI</title>
      <style>
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        body {
          color: #1e293b;
          background-color: #ffffff;
          padding: 32px;
          font-size: 13px;
          line-height: 1.5;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 3px solid #006B5C;
          padding-bottom: 18px;
          margin-bottom: 24px;
        }
        .brand-col {
          display: flex;
          flex-direction: column;
        }
        .brand-title {
          font-size: 24px;
          font-weight: 800;
          color: #006B5C;
          letter-spacing: -0.5px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .brand-subtitle {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          color: #64748b;
          margin-top: 2px;
          font-weight: 600;
        }
        .clinic-name {
          font-size: 15px;
          font-weight: 700;
          color: #0f172a;
          margin-top: 8px;
        }
        .doc-badge-col {
          text-align: right;
        }
        .doc-name {
          font-size: 16px;
          font-weight: 700;
          color: #0f172a;
        }
        .license-tag {
          display: inline-block;
          background-color: ${isLicenseValid ? '#d1fae5' : '#fee2e2'};
          color: ${isLicenseValid ? '#065f46' : '#991b1b'};
          font-size: 11px;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 4px;
          margin-top: 4px;
        }
        .report-meta-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          background-color: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 14px 18px;
          margin-bottom: 22px;
          gap: 12px;
        }
        .meta-item {
          display: flex;
          flex-direction: column;
        }
        .meta-label {
          font-size: 10px;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          margin-bottom: 2px;
        }
        .meta-value {
          font-size: 13px;
          font-weight: 600;
          color: #0f172a;
        }
        .section-card {
          margin-bottom: 20px;
        }
        .section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1.5px solid #cbd5e1;
          padding-bottom: 6px;
          margin-bottom: 12px;
        }
        .section-title {
          font-size: 12px;
          font-weight: 800;
          color: #006B5C;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        table.rx-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        table.rx-table th {
          background-color: #006B5C;
          color: #ffffff;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          text-align: left;
          padding: 8px 12px;
        }
        table.rx-table td {
          padding: 10px 12px;
          border-bottom: 1px solid #e2e8f0;
          vertical-align: top;
        }
        table.rx-table tr:nth-child(even) {
          background-color: #f8fafc;
        }
        .col-idx { width: 30px; font-weight: 700; color: #64748b; }
        .col-drug { width: 35%; }
        .col-freq { width: 30%; }
        .col-inst { width: 30%; }
        .drug-name { font-size: 14px; font-weight: 700; color: #0f172a; }
        .drug-form-strength { font-size: 11px; color: #64748b; margin-top: 2px; }
        .freq-badge {
          display: inline-block;
          background-color: #e0f2fe;
          color: #0369a1;
          padding: 3px 8px;
          border-radius: 4px;
          font-weight: 600;
          font-size: 11px;
        }
        .duration-badge {
          display: inline-block;
          background-color: #f0fdf4;
          color: #166534;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 10px;
          margin-top: 4px;
          font-weight: 600;
        }
        .no-meds {
          text-align: center;
          padding: 24px;
          color: #64748b;
          font-style: italic;
        }
        .advice-card {
          background-color: #fffbeb;
          border: 1px solid #fef3c7;
          border-radius: 8px;
          padding: 14px;
        }
        .advice-list {
          padding-left: 20px;
          margin-top: 8px;
          color: #92400e;
        }
        .advice-list li {
          margin-bottom: 4px;
          font-size: 12px;
        }
        .warning-card {
          background-color: #fef2f2;
          border: 1px solid #fee2e2;
          border-radius: 8px;
          padding: 14px;
        }
        .alert-title { color: #dc2626 !important; }
        .interaction-row {
          margin-top: 8px;
          padding-bottom: 6px;
          border-bottom: 1px dashed #fca5a5;
        }
        .interaction-pair { color: #991b1b; font-size: 12px; }
        .interaction-desc { color: #7f1d1d; font-size: 11px; margin-top: 2px; }
        .footer {
          margin-top: 36px;
          border-top: 1px solid #e2e8f0;
          padding-top: 16px;
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
        }
        .verification-seal {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .seal-circle {
          width: 44px;
          height: 44px;
          border-radius: 22px;
          background-color: #ecfdf5;
          border: 2px solid #059669;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          color: #059669;
          font-size: 18px;
        }
        .seal-text {
          font-size: 11px;
          color: #065f46;
          font-weight: 600;
        }
        .sig-block {
          text-align: center;
          width: 180px;
        }
        .sig-line {
          border-bottom: 1.5px solid #0f172a;
          margin-bottom: 6px;
          height: 30px;
        }
        .sig-label {
          font-size: 11px;
          color: #475569;
          font-weight: 600;
        }
        .disclaimer {
          font-size: 9px;
          color: #94a3b8;
          text-align: center;
          margin-top: 24px;
          line-height: 1.4;
        }
      </style>
    </head>
    <body>
      <!-- Header -->
      <div class="header">
        <div class="brand-col">
          <div class="brand-title">&#10010; MediScan Digitized Rx</div>
          <div class="brand-subtitle">Clinical Intelligence & Verification Report</div>
          <div class="clinic-name">${hospitalName}</div>
        </div>
        <div class="doc-badge-col">
          <div class="doc-name">${doctorName}</div>
          <div class="license-tag">
            ${isLicenseValid ? '&#10004; VERIFIED LICENSE' : '&#9888; UNVERIFIED'}: ${licenseCode}
          </div>
          <div style="font-size: 10px; color: #64748b; margin-top: 4px;">
            Signature: ${signaturePresent ? 'Verified Present &#10004;' : 'Missing / Unsigned'}
          </div>
        </div>
      </div>

      <!-- Patient Demographics & Report Meta -->
      <div class="report-meta-grid">
        <div class="meta-item">
          <span class="meta-label">Patient Name</span>
          <span class="meta-value">${patientName}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Age / Gender</span>
          <span class="meta-value">${patientAge} yrs &bull; ${patientSex}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Date & Time</span>
          <span class="meta-value">${dateStr}</span>
        </div>
        ${diseases.length > 0 ? `
          <div class="meta-item" style="grid-column: span 3;">
            <span class="meta-label">Diagnosis / Clinical Findings</span>
            <span class="meta-value">${diseases.join(', ')}</span>
          </div>
        ` : ''}
      </div>

      <!-- Prescribed Medications Table -->
      <div class="section-card">
        <div class="section-header">
          <span class="section-title">PRESCRIBED MEDICATIONS & DOSAGE SCHEDULE (${validMedicines.length})</span>
        </div>
        <table class="rx-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Medication & Strength</th>
              <th>Frequency / Timing</th>
              <th>Instructions</th>
            </tr>
          </thead>
          <tbody>
            ${rxRows}
          </tbody>
        </table>
      </div>

      <!-- Advice Section -->
      ${adviceHtml}

      <!-- Interaction Alerts -->
      ${interactionsHtml}

      <!-- Footer / Signoff -->
      <div class="footer">
        <div class="verification-seal">
          <div class="seal-circle">&#10003;</div>
          <div class="seal-text">
            <div><strong>Digitally Authenticated</strong></div>
            <div>MediScan OCR & NLP Engine v4.2</div>
          </div>
        </div>
        <div class="sig-block">
          <div class="sig-line"></div>
          <div class="sig-label">${doctorName}</div>
          <div style="font-size: 9px; color: #94a3b8;">Physician Signature / Stamp</div>
        </div>
      </div>

      <div class="disclaimer">
        This document is an AI-assisted digitized medical record generated by PrescriptoAI / MediScan. 
        Always verify medication names and dosages with the original physician's order before dispensing.
      </div>
    </body>
    </html>
  `;
}

/**
 * Generates a PDF file from prescription data and opens native share sheet.
 */
export async function exportPrescriptionPDF(data) {
  try {
    const htmlContent = generatePrescriptionHTML(data);
    
    // Generate PDF file using expo-print
    const generatedPdf = await Print.printToFileAsync({
      html: htmlContent,
      base64: true,
    });

    // Copy/Write file to safe local directory (FileSystem.documentDirectory) to bypass Android read restriction
    const baseDir = FileSystem.documentDirectory || FileSystem.cacheDirectory || '';
    const safeBase = baseDir.endsWith('/') ? baseDir : `${baseDir}/`;
    const newUri = safeBase + 'prescription.pdf';

    try {
      if (generatedPdf?.base64 && typeof FileSystem.writeAsStringAsync === 'function') {
        await FileSystem.writeAsStringAsync(newUri, generatedPdf.base64, {
          encoding: 'base64',
        });
      } else {
        const sourceUri = generatedPdf.uri.startsWith('file://') ? generatedPdf.uri : `file://${generatedPdf.uri}`;
        await FileSystem.copyAsync({ from: sourceUri, to: newUri });
      }
    } catch (writeErr) {
      console.warn("Direct write/copy to documentDirectory failed, trying copyAsync fallback:", writeErr);
      const sourceUri = generatedPdf.uri.startsWith('file://') ? generatedPdf.uri : `file://${generatedPdf.uri}`;
      await FileSystem.copyAsync({ from: sourceUri, to: newUri });
    }

    // Ensure the URI passed to shareAsync explicitly has the file:// prefix
    const shareableUri = newUri.startsWith('file://') ? newUri : `file://${newUri}`;

    // Check if sharing is available on current device
    const isAvailable = await Sharing.isAvailableAsync();
    if (isAvailable) {
      await Sharing.shareAsync(shareableUri, {
        UTI: '.pdf',
        mimeType: 'application/pdf',
        dialogTitle: 'Export Medical Prescription Report',
      });
      return { success: true, uri: shareableUri };
    } else {
      Alert.alert(
        'PDF Exported Successfully',
        `Medical report generated at: ${shareableUri}`,
        [{ text: 'OK' }]
      );
      return { success: true, uri: shareableUri };
    }
  } catch (error) {
    console.error('Error exporting prescription PDF:', error);
    Alert.alert('PDF Export Error', error.message || 'Could not generate medical report.');
    return { success: false, error };
  }
}
