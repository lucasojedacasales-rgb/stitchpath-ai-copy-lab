import React from 'react';
import { LAB_STATUS, RULE_STATUS } from '@/lib/hatchLab';
export default function StatusBadge({ status, rule = false }) {
  const value = rule ? ({ candidate: LAB_STATUS.untested, validating: LAB_STATUS.validation, approved: LAB_STATUS.approved, rejected: LAB_STATUS.failed }[status]) : LAB_STATUS[status];
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${value?.className || LAB_STATUS.untested.className}`}>{rule ? (RULE_STATUS[status] || status) : (value?.label || status)}</span>;
}