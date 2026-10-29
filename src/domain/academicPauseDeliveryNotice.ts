export type AcademicPauseDelivery = {
  attempted?: number;
  succeeded?: number;
  failed?: number;
  skipped?: boolean;
  queued?: boolean;
};

export function academicPauseDeliveryNotice(delivery?: AcademicPauseDelivery) {
  if (delivery?.skipped)
    return "Google Calendar delivery is paused. Subscriber updates have not been confirmed.";
  if ((delivery?.failed ?? 0) > 0)
    return "Some Google Calendar updates failed. Subscriber updates are not complete.";
  if (delivery?.queued)
    return "Google Calendar updates are queued. Delivery is pending.";
  if (
    (delivery?.attempted ?? 0) > 0 &&
    delivery?.succeeded === delivery?.attempted
  )
    return "Google Calendar updated. Subscribed feeds refresh on their own schedule.";
  return "Subscriber delivery has not been confirmed.";
}
