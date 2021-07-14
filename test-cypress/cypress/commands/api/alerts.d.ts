// load the global Cypress types
/// <reference types="cypress" />

interface ComparableAlertEvent {
  recId: number;
}

declare namespace Cypress {
  interface Chainable {
    /**
     * create an alert for user for what on this camera
     */
    apiCreateAlert(
      user: string,
      what: string,
      camera: string,
      alertName: string
    ): Chainable<Element>;

    checkAlerts(
      user: string,
      camera: string,
      expectedAlerts: ComparableAlertEvents[]
    ): Chainable<Element>;
  }
}
