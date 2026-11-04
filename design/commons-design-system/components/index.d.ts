import type * as React from 'react';
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'secondary' | 'quiet'; size?: 'md' | 'sm' }
export declare function Button(props: ButtonProps): React.ReactElement;
export interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> { label?: string; hideLabel?: boolean; hint?: string; error?: string }
export declare function TextField(props: TextFieldProps): React.ReactElement;
export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> { label?: React.ReactNode }
export declare function Checkbox(props: CheckboxProps): React.ReactElement;
export type ReportStatus = 'reported' | 'reviewing' | 'in-progress' | 'resolved' | 'urgent' | 'closed';
export interface StatusBadgeProps { status?: ReportStatus; children?: React.ReactNode; className?: string }
export declare function StatusBadge(props: StatusBadgeProps): React.ReactElement;
export interface IssueCardProps { title: React.ReactNode; media?: React.ReactNode; status?: ReportStatus; location?: string; time?: string; followers?: number; href?: string; className?: string }
export declare function IssueCard(props: IssueCardProps): React.ReactElement;
export interface FeatureItemProps { title: React.ReactNode; icon?: React.ReactNode; children?: React.ReactNode; className?: string }
export declare function FeatureItem(props: FeatureItemProps): React.ReactElement;
export interface CalloutBandProps { title: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; art?: React.ReactNode; className?: string }
export declare function CalloutBand(props: CalloutBandProps): React.ReactElement;
export interface TimelineStep { title: string; date?: string; note?: string; state?: 'done' | 'current' | 'upcoming' }
export interface StatusTimelineProps { steps: TimelineStep[]; className?: string }
export declare function StatusTimeline(props: StatusTimelineProps): React.ReactElement;
export interface InlineSignupProps { label?: string; placeholder?: string; cta?: string; consent?: React.ReactNode; onSubmit?: (email: string) => void; className?: string }
export declare function InlineSignup(props: InlineSignupProps): React.ReactElement;
declare global { interface Window { Commons: { Button: typeof Button; TextField: typeof TextField; Checkbox: typeof Checkbox; StatusBadge: typeof StatusBadge; IssueCard: typeof IssueCard; FeatureItem: typeof FeatureItem; CalloutBand: typeof CalloutBand; StatusTimeline: typeof StatusTimeline; InlineSignup: typeof InlineSignup } } }
