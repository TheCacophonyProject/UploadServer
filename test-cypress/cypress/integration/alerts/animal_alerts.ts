/// <reference path="../../support/index.d.ts" />

describe("Alerts : recordings get alerted", () => {
  const Tiny = "TinyAlerts";

  const AlertGroup = "AlertGroup";
  const RoadCamera = "RoadCamera";
  const TreeCamera = "TreeCamera";

  before(() => {
    cy.apiCreateUserGroup(Tiny, AlertGroup);
    cy.apiCreateCamera(TreeCamera, AlertGroup);
  });

  it("Device without alerts does not receive an alert", () => {
    const camera = "no_alerts";
    cy.apiCreateCamera(camera, AlertGroup);
    cy.uploadRecording(camera, {
      processingState: "FINISHED",
      tags: ["possum", "rat"]
    });
    cy.checkAlerts(Tiny, camera, []);
  });

  it("Possum alert is sent", () => {
    const camera = "possum_alert";
    cy.apiCreateCamera(camera, AlertGroup);
    cy.apiCreateAlert(Tiny, "possum", camera, "possum1");

    cy.uploadRecording(camera, {
      processingState: "FINISHED",
      tags: ["possum"]
    }).then((recID: number) => {
      cy.checkAlerts(Tiny, camera, [{ recId: recID }]);
      cy.uploadRecording(camera, {
        processingState: "FINISHED",
        tags: ["rat"]
      });
      cy.checkAlerts(Tiny, camera, [{ recId: recID }]);
    });
  });

  it("No possum alert is sent for a rat", () => {
    const camera = "not a rat alert";
    cy.apiCreateCamera(camera, AlertGroup);
    cy.apiCreateAlert(Tiny, "possum", camera, "possum1");

    cy.uploadRecording(camera, { processingState: "FINISHED", tags: ["rat"] });
    cy.checkAlerts(Tiny, camera, []);
  });
  it("No possum alert is sent for a possum on a different device", () => {
    const camera = "possum catcher";
    const cameraTwo = "rat catcher";

    cy.apiCreateCamera(camera, AlertGroup);
    cy.apiCreateAlert(Tiny, "possum", camera, "possum1");
    cy.apiCreateCamera(cameraTwo, AlertGroup);

    cy.uploadRecording(cameraTwo, {
      processingState: "FINISHED",
      tags: ["possum"]
    });
    cy.checkAlerts(Tiny, camera, []);
  });

  it("Alert is based of visit tag, a recording with 2 possum tags and 1 rat is a possum", () => {
    const camera = "possum visit";
    cy.apiCreateCamera(camera, AlertGroup);
    cy.apiCreateAlert(Tiny, "possum", camera, "possum1");

    cy.uploadRecording(camera, {
      processingState: "FINISHED",
      tags: ["rat", "possum", "possum"]
    }).then((recID: number) => {
      cy.checkAlerts(Tiny, camera, [{ recId: recID }]);
    });
  });
});
