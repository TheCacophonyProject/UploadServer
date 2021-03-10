/// <reference path="../../support/index.d.ts" />
import moment from "moment";
import { EventTypes } from "../../commands/api/events";

describe("Device names", () => {
  const group = "stoppers";
  const user = "Jerry"
  before(() => {
    cy.apiCreateUserGroup(user, group);
  });

  it("New Device isn't reported", () => {
    const camera = "Active"
    cy.apiCreateCamera(camera, group)
    cy.recordEvent(camera,EventTypes.POWERED_ON)
    cy.checkStopped(user,camera, false);
  });
  it("Device that has been on for longer than 12 hours and hasn't stopped is reported", () => {
    const camera = "c1"
    cy.apiCreateCamera(camera, group)
    cy.recordEvent(camera,EventTypes.POWERED_ON,{}, moment().subtract(13,"hours"))
    cy.checkStopped(user,camera, true);
  });

  it("Device started and stopped yesterday, and not today is reporterd", () => {
    const camera = "c2"
    cy.apiCreateCamera(camera, group)
    const yesterdayStart = moment().subtract(40,"hours");
    const yesterdayStop = yesterdayStart.clone().add(28,"hours");
    cy.recordEvent(camera, EventTypes.POWERED_ON,{}, yesterdayStart)
    cy.recordEvent(camera, EventTypes.POWERED_OFF,{}, yesterdayStop)
    cy.checkStopped(user,camera, true);
  });

  it("Device started over 12 hours ago but never stopped is reported", () => {
    const camera = "c3"
    cy.apiCreateCamera(camera, group)
    const yesterday = moment().subtract(13,"hours");
    cy.recordEvent(camera, EventTypes.POWERED_ON,{}, yesterday)
    cy.checkStopped(user,camera, true);
  });

  it("Once reported is not reported again", () => {
    const camera = "c4"
    cy.apiCreateCamera(camera, group)
    const yesterday = moment().subtract(13,"hours");
    cy.recordEvent(camera, EventTypes.POWERED_ON,{}, yesterday)
    cy.checkStopped(user,camera, true);
    cy.recordEvent(camera, EventTypes.STOP_REPORTED)
    cy.checkStopped(user,camera, false);
  });

  it("Device powered on & off yesterday but only on last night", () => {
    const camera = "c5"
    cy.apiCreateCamera(camera, group)
    const priorOn = moment().subtract(37,"hours");
    const priorStop =priorOn.clone().add(12,"hours");
    const lastStart = priorOn.clone().add(24,"hours");

    cy.recordEvent(camera, EventTypes.POWERED_ON,{}, priorOn)
    cy.recordEvent(camera, EventTypes.POWERED_OFF,{},priorStop)
    cy.recordEvent(camera, EventTypes.POWERED_ON,{},  lastStart)
    cy.checkStopped(user,camera, true);
  });

  it("Device checked before it is expected to have powered down", () => {
    const camera = "c6"
    cy.apiCreateCamera(camera, group)
    const priorOn = moment().subtract(36,"hours");
    const priorStop =moment().subtract(24,"hours");
    const lastStart = priorOn.clone().add(24,"hours");

    cy.recordEvent(camera, EventTypes.POWERED_ON,{}, priorOn)
    cy.recordEvent(camera, EventTypes.POWERED_OFF,{},priorStop)
    cy.recordEvent(camera, EventTypes.POWERED_ON,{},  lastStart)
    cy.checkStopped(user,camera, false);
  });


  it("Device hasn't been checked for a long time", () => {
    const camera = "c7"
    cy.apiCreateCamera(camera, group)
    const priorOn = moment().subtract(20,"days");
    const priorStop =moment().subtract(20,"days");
    cy.recordEvent(camera, EventTypes.POWERED_ON,{}, priorOn)
    cy.recordEvent(camera, EventTypes.POWERED_OFF,{},priorStop)
    cy.checkStopped(user,camera, true);
  });


  it("Device that has been reported, is reported again after new power cycles", () => {
    const camera = "c8"
    cy.apiCreateCamera(camera, group)
    const priorOn = moment().subtract(5,"days");
    const priorStop =moment().subtract(5,"days");
    cy.recordEvent(camera, EventTypes.POWERED_ON,{}, priorOn)
    cy.recordEvent(camera, EventTypes.POWERED_OFF,{},priorStop)
    cy.checkStopped(user,camera, true);
    cy.recordEvent(camera, EventTypes.STOP_REPORTED,{}, priorStop)

    const newOn = moment().subtract(3,"days");
    const newOff =moment().subtract(3,"days");
    cy.recordEvent(camera, EventTypes.POWERED_ON,{},newOn)
    cy.recordEvent(camera, EventTypes.POWERED_OFF,{},newOff)
    cy.checkStopped(user,camera, true);

  });

});