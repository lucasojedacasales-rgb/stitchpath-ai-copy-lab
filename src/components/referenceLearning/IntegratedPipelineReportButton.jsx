import { Download } from 'lucide-react';
import { INTEGRATED_PIPELINE_REPORT_MD } from '@/components/referenceLearning/integratedPipelineReportContent';
import { SATIN_PHASE_ORDER_FIX_REPORT_MD } from '@/components/referenceLearning/satinPhaseOrderFixReportContent';
import { INTEGRATED_PIPELINE_AFTER_SATIN_V2_MD } from '@/components/referenceLearning/integratedPipelineAfterSatinV2Content';
import { INTEGRATED_PIPELINE_AFTER_SATIN_V2_RUNTIME_MD } from '@/components/referenceLearning/integratedPipelineAfterSatinV2RuntimeContent';
import { UNDERLAY_CANDIDATE_AUDIT_V1_MD } from '@/components/referenceLearning/underlayCandidateAuditV1Content';
import { UNDERLAY_GENERATOR_REPORT_V1_MD } from '@/components/referenceLearning/underlayGeneratorReportV1Content';
import { INTEGRATED_PIPELINE_AFTER_UNDERLAY_V1_MD } from '@/components/referenceLearning/integratedPipelineAfterUnderlayV1Content';
import { ACCEPTED_WILCOM_SAMPLE_UPDATE_REPORT_V1_MD } from '@/components/referenceLearning/acceptedWilcomSampleUpdateReportContent';
import { VALIDATION_AFTER_WILCOM_SAMPLE_V1_MD } from '@/components/referenceLearning/validationAfterWilcomSampleV1Content';

const REPORTS = [
  { label: 'Wilcom Sample', filename: 'REFERENCE_LEARNING_ACCEPTED_WILCOM_SAMPLE_UPDATE_REPORT_V1.md', content: ACCEPTED_WILCOM_SAMPLE_UPDATE_REPORT_V1_MD, color: 'emerald' },
  { label: 'After Wilcom', filename: 'REFERENCE_LEARNING_VALIDATION_AFTER_WILCOM_SAMPLE_V1.md', content: VALIDATION_AFTER_WILCOM_SAMPLE_V1_MD, color: 'emerald' },
  { label: 'Underlay V1', filename: 'UNDERLAY_GENERATOR_REPORT_V1.md', content: UNDERLAY_GENERATOR_REPORT_V1_MD, color: 'amber' },
  { label: 'After Underlay', filename: 'REFERENCE_INTEGRATED_PIPELINE_AFTER_UNDERLAY_V1.md', content: INTEGRATED_PIPELINE_AFTER_UNDERLAY_V1_MD, color: 'amber' },
  { label: 'Underlay Audit', filename: 'UNDERLAY_CANDIDATE_AUDIT_V1.md', content: UNDERLAY_CANDIDATE_AUDIT_V1_MD, color: 'amber' },
  { label: 'Runtime V2', filename: 'REFERENCE_INTEGRATED_PIPELINE_AFTER_SATIN_V2_RUNTIME.md', content: INTEGRATED_PIPELINE_AFTER_SATIN_V2_RUNTIME_MD, color: 'emerald' },
  { label: 'Order Fix V1', filename: 'SATIN_PHASE_ORDER_FIX_REPORT_V1.md', content: SATIN_PHASE_ORDER_FIX_REPORT_MD, color: 'violet' },
  { label: 'Integrated V2', filename: 'REFERENCE_INTEGRATED_PIPELINE_AFTER_SATIN_V2.md', content: INTEGRATED_PIPELINE_AFTER_SATIN_V2_MD, color: 'emerald' },
  { label: 'Integrated V1', filename: 'REFERENCE_INTEGRATED_PIPELINE_AFTER_SATIN_V1.md', content: INTEGRATED_PIPELINE_REPORT_MD, color: 'sky' },
];

export default function IntegratedPipelineReportButton() {
  const handleDownload = (report) => {
    const blob = new Blob([report.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = report.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {REPORTS.map((report) => (
        <button
          key={report.filename}
          onClick={() => handleDownload(report)}
          className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-xs transition-colors ${report.color === 'violet' ? 'border-violet-500/30 bg-violet-900/15 text-violet-200 hover:bg-violet-900/25' : report.color === 'emerald' ? 'border-emerald-500/30 bg-emerald-900/15 text-emerald-200 hover:bg-emerald-900/25' : report.color === 'amber' ? 'border-amber-500/30 bg-amber-900/15 text-amber-200 hover:bg-amber-900/25' : 'border-sky-500/30 bg-sky-900/15 text-sky-200 hover:bg-sky-900/25'}`}
        >
          <span>
            <span className="block font-bold">{report.label}</span>
            <span className="text-[10px] text-slate-400">{report.filename}</span>
          </span>
          <Download className="w-4 h-4 flex-shrink-0" />
        </button>
      ))}
    </div>
  );
}