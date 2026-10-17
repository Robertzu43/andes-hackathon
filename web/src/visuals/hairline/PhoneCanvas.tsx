import { Phone } from '@lucasmarkes/hairline/react';

/** Separate chunk: the complete animation engine stays out of the still path. */
export default function PhoneCanvas({ label, intensity }: { label: string; intensity: number }) {
  return <Phone className="andes-phone__canvas" label={label} intensity={intensity}
    theme="light" play={false} aria-hidden="true" />;
}
