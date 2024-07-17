import { loadFromPath } from 'fhir-package-loader';
import { ValueSetExporter, Package } from '../../src/export';
import { FSHDocument, FSHTank } from '../../src/import';
import {
  FshValueSet,
  FshCode,
  VsOperator,
  FshCodeSystem,
  RuleSet,
  Instance
} from '../../src/fshtypes';
import { loggerSpy } from '../testhelpers/loggerSpy';
import { TestFisher } from '../testhelpers';
import { FHIRDefinitions } from '../../src/fhirdefs';
import path from 'path';
import { cloneDeep } from 'lodash';
import {
  CaretValueRule,
  InsertRule,
  AssignmentRule,
  ValueSetComponentRule,
  ValueSetConceptComponentRule,
  ValueSetFilterComponentRule,
  ConceptRule
} from '../../src/fshtypes/rules';
import { minimalConfig } from '../utils/minimalConfig';

describe('ValueSetExporter', () => {
  let defs: FHIRDefinitions;
  let doc: FSHDocument;
  let pkg: Package;
  let exporter: ValueSetExporter;

  beforeAll(() => {
    defs = new FHIRDefinitions();
    loadFromPath(path.join(__dirname, '..', 'testhelpers', 'testdefs'), 'r4-definitions', defs);
  });

  beforeEach(() => {
    loggerSpy.reset();
    doc = new FSHDocument('fileName');
    const input = new FSHTank([doc], minimalConfig);
    pkg = new Package(input.config);
    const fisher = new TestFisher(input, defs, pkg);
    exporter = new ValueSetExporter(input, pkg, fisher);
    loggerSpy.reset();
  });

  it('should output empty results with empty input', () => {
    const exported = exporter.export().valueSets;
    expect(exported).toEqual([]);
  });

  it('should export a single value set', () => {
    const valueSet = new FshValueSet('BreakfastVS');
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      name: 'BreakfastVS',
      id: 'BreakfastVS',
      status: 'draft',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/BreakfastVS'
    });
  });

  it('should add source info for the exported value set to the package', () => {
    const valueSet = new FshValueSet('MyValueSet').withFile('VS.fsh').withLocation([3, 6, 30, 34]);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(pkg.fshMap.get('ValueSet-MyValueSet.json')).toEqual({
      file: 'VS.fsh',
      location: {
        startLine: 3,
        startColumn: 6,
        endLine: 30,
        endColumn: 34
      },
      fshName: 'MyValueSet',
      fshType: 'ValueSet'
    });
  });

  it('should export multiple value sets', () => {
    const breakfast = new FshValueSet('BreakfastVS');
    const lunch = new FshValueSet('LunchVS');
    doc.valueSets.set(breakfast.name, breakfast);
    doc.valueSets.set(lunch.name, lunch);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(2);
  });

  it('should export a value set with additional metadata', () => {
    const valueSet = new FshValueSet('BreakfastVS');
    valueSet.title = 'Breakfast Values';
    valueSet.description = 'A value set for breakfast items';
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      name: 'BreakfastVS',
      id: 'BreakfastVS',
      status: 'draft',
      title: 'Breakfast Values',
      description: 'A value set for breakfast items',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/BreakfastVS'
    });
  });

  it('should export a value set with status and version in FSHOnly mode', () => {
    // Create a FSHOnly config with a status and version
    const fshOnlyConfig = cloneDeep(minimalConfig);
    fshOnlyConfig.FSHOnly = true;
    fshOnlyConfig.version = '0.1.0';
    fshOnlyConfig.status = 'active';
    const input = new FSHTank([doc], fshOnlyConfig);
    pkg = new Package(input.config);
    const fisher = new TestFisher(input, defs, pkg);
    exporter = new ValueSetExporter(input, pkg, fisher);

    const valueSet = new FshValueSet('BreakfastVS');
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      name: 'BreakfastVS',
      id: 'BreakfastVS',
      status: 'active',
      version: '0.1.0',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/BreakfastVS'
    });
  });

  it('should warn when title and/or description is an empty string', () => {
    const valueSet = new FshValueSet('BreakfastVS');
    valueSet.title = '';
    valueSet.description = '';
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);

    expect(loggerSpy.getAllMessages('warn').length).toBe(2);
    expect(loggerSpy.getFirstMessage('warn')).toMatch(
      'Value set BreakfastVS has a title field that should not be empty.'
    );
    expect(loggerSpy.getLastMessage('warn')).toMatch(
      'Value set BreakfastVS has a description field that should not be empty.'
    );
  });

  it('should log a message when the value set has an invalid id', () => {
    const valueSet = new FshValueSet('BreakfastVS')
      .withFile('Breakfast.fsh')
      .withLocation([3, 7, 7, 12]);
    valueSet.id = 'Delicious!';
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0].id).toBe('Delicious!');
    expect(loggerSpy.getLastMessage('error')).toMatch(/does not represent a valid FHIR id/s);
    expect(loggerSpy.getLastMessage('error')).toMatch(/File: Breakfast\.fsh.*Line: 3 - 7\D*/s);
  });

  it('should not log a message when the value set overrides an invalid id with a Caret Rule', () => {
    const valueSet = new FshValueSet('BreakfastVS')
      .withFile('Breakfast.fsh')
      .withLocation([3, 7, 7, 12]);
    valueSet.id = 'Delicious!';
    const idRule = new CaretValueRule('');
    idRule.caretPath = 'id';
    idRule.value = 'delicious';
    valueSet.rules.push(idRule);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0].id).toBe('delicious');
    expect(loggerSpy.getAllLogs('warn')).toHaveLength(0);
  });

  it('should log a message when the value set overrides an invalid id with an invalid Caret Rule', () => {
    const valueSet = new FshValueSet('BreakfastVS')
      .withFile('Breakfast.fsh')
      .withLocation([3, 7, 7, 12]);
    valueSet.id = 'Delicious!';
    const idRule = new CaretValueRule('').withFile('Breakfast.fsh').withLocation([4, 4, 4, 4]);
    idRule.caretPath = 'id';
    idRule.value = 'StillDelicious!';
    valueSet.rules.push(idRule);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0].id).toBe('StillDelicious!');
    expect(loggerSpy.getLastMessage('error')).toMatch(/does not represent a valid FHIR id/s);
    expect(loggerSpy.getLastMessage('error')).toMatch(/File: Breakfast\.fsh.*Line: 4\D*/s);
  });

  it('should log a message when the value set overrides a valid id with an invalid Caret Rule', () => {
    const valueSet = new FshValueSet('BreakfastVS')
      .withFile('Breakfast.fsh')
      .withLocation([3, 7, 7, 12]);
    valueSet.id = 'this-is-valid';
    const idRule = new CaretValueRule('').withFile('Breakfast.fsh').withLocation([4, 4, 4, 4]);
    idRule.caretPath = 'id';
    idRule.value = 'Oh No!';
    valueSet.rules.push(idRule);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0].id).toBe('Oh No!');
    expect(loggerSpy.getLastMessage('error')).toMatch(/does not represent a valid FHIR id/s);
    expect(loggerSpy.getLastMessage('error')).toMatch(/File: Breakfast\.fsh.*Line: 4\D*/s);
  });

  it('should log a message when the value set has an invalid name', () => {
    const valueSet = new FshValueSet('All-you-can-eat')
      .withFile('Breakfast.fsh')
      .withLocation([2, 4, 8, 23]);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0].name).toBe('All-you-can-eat');
    expect(loggerSpy.getLastMessage('warn')).toMatch(
      /may not be suitable for machine processing applications such as code generation/s
    );
    expect(loggerSpy.getLastMessage('warn')).toMatch(/File: Breakfast\.fsh.*Line: 2 - 8\D*/s);
  });

  it('should not log a message when the value set overrides an invalid name with a Caret Rule', () => {
    const valueSet = new FshValueSet('All-you-can-eat')
      .withFile('Strange.fsh')
      .withLocation([3, 4, 8, 24]);
    const nameRule = new CaretValueRule('');
    nameRule.caretPath = 'name';
    nameRule.value = 'AllYouCanEat';
    valueSet.rules.push(nameRule);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0].name).toBe('AllYouCanEat');
    expect(loggerSpy.getAllLogs('warn')).toHaveLength(0);
  });

  it('should log a message when the value set overrides an invalid name with an invalid Caret Rule', () => {
    const valueSet = new FshValueSet('All-you-can-eat')
      .withFile('Strange.fsh')
      .withLocation([3, 4, 8, 24]);
    const nameRule = new CaretValueRule('').withFile('Strange.fsh').withLocation([4, 4, 4, 4]);
    nameRule.caretPath = 'name';
    nameRule.value = 'All-you-can-eat';
    valueSet.rules.push(nameRule);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0].name).toBe('All-you-can-eat');
    expect(loggerSpy.getLastMessage('warn')).toMatch(
      /may not be suitable for machine processing applications such as code generation/s
    );
    expect(loggerSpy.getLastMessage('warn')).toMatch(/File: Strange\.fsh.*Line: 4\D*/s);
  });

  it('should log a message when the value set overrides a valid name with an invalid Caret Rule', () => {
    const valueSet = new FshValueSet('AllYouCanEat')
      .withFile('Strange.fsh')
      .withLocation([3, 4, 8, 24]);
    const nameRule = new CaretValueRule('').withFile('Strange.fsh').withLocation([4, 4, 4, 4]);
    nameRule.caretPath = 'name';
    nameRule.value = 'All-you-can-eat';
    valueSet.rules.push(nameRule);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0].name).toBe('All-you-can-eat');
    expect(loggerSpy.getLastMessage('warn')).toMatch(
      /may not be suitable for machine processing applications such as code generation/s
    );
    expect(loggerSpy.getLastMessage('warn')).toMatch(/File: Strange\.fsh.*Line: 4\D*/s);
  });

  it('should sanitize the id and log a message when a valid name is used to make an invalid id', () => {
    const valueSet = new FshValueSet('Not_good_id')
      .withFile('Wrong.fsh')
      .withLocation([2, 8, 5, 18]);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported[0].name).toBe('Not_good_id');
    expect(exported[0].id).toBe('Not-good-id');
    expect(loggerSpy.getLastMessage('warn')).toMatch(
      /The string "Not_good_id" represents a valid FHIR name but not a valid FHIR id.*The id will be exported as "Not-good-id"/s
    );
    expect(loggerSpy.getLastMessage('warn')).toMatch(/File: Wrong\.fsh.*Line: 2 - 5\D*/s);
  });

  it('should sanitize the id and log a message when a long valid name is used to make an invalid id', () => {
    let longId = 'Toolong';
    while (longId.length < 65) longId += 'longer';
    const valueSet = new FshValueSet(longId).withFile('Wrong.fsh').withLocation([2, 8, 5, 18]);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    const expectedId = longId.slice(0, 64);
    expect(exported[0].name).toBe(longId);
    expect(exported[0].id).toBe(expectedId);
    const warning = new RegExp(
      `The string "${longId}" represents a valid FHIR name but not a valid FHIR id.*The id will be exported as "${expectedId}"`,
      's'
    );
    expect(loggerSpy.getLastMessage('warn')).toMatch(warning);
    expect(loggerSpy.getLastMessage('warn')).toMatch(/File: Wrong\.fsh.*Line: 2 - 5\D*/s);
  });
  it('should log an error when multiple value sets have the same id', () => {
    const firstValueSet = new FshValueSet('FirstVS')
      .withFile('ValueSets.fsh')
      .withLocation([2, 8, 5, 15]);
    firstValueSet.id = 'my-value-set';
    const secondValueSet = new FshValueSet('SecondVS')
      .withFile('ValueSets.fsh')
      .withLocation([7, 8, 9, 19]);
    secondValueSet.id = 'my-value-set';
    doc.valueSets.set(firstValueSet.name, firstValueSet);
    doc.valueSets.set(secondValueSet.name, secondValueSet);

    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(2);
    expect(loggerSpy.getLastMessage('error')).toMatch(/Multiple value sets with id my-value-set/s);
    expect(loggerSpy.getLastMessage('error')).toMatch(/File: ValueSets\.fsh.*Line: 7 - 9\D*/s);
  });

  it('should export each value set once, even if export is called more than once', () => {
    const breakfast = new FshValueSet('BreakfastVS');
    doc.valueSets.set(breakfast.name, breakfast);
    let exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
  });

  it('should export a value set that includes a component from a system', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const component = new ValueSetConceptComponentRule(true);
    component.from = { system: 'http://food.org/food' };
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      name: 'DinnerVS',
      id: 'DinnerVS',
      status: 'draft',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      compose: {
        include: [{ system: 'http://food.org/food' }]
      }
    });
  });

  it('should export a value set that includes a component from a named system', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const component = new ValueSetConceptComponentRule(true);
    component.from = { system: 'FoodCS' };
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);
    const foodCS = new FshCodeSystem('FoodCS');
    foodCS.id = 'food';
    doc.codeSystems.set(foodCS.name, foodCS);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      name: 'DinnerVS',
      id: 'DinnerVS',
      status: 'draft',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      compose: {
        include: [{ system: 'http://hl7.org/fhir/us/minimal/CodeSystem/food' }]
      }
    });
  });

  it('should export a value set that includes a component from a value set', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const component = new ValueSetConceptComponentRule(true);
    component.from = {
      valueSets: [
        'http://food.org/food/ValueSet/hot-food',
        'http://food.org/food/ValueSet/cold-food'
      ]
    };
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'DinnerVS',
      name: 'DinnerVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      status: 'draft',
      compose: {
        include: [
          {
            valueSet: [
              'http://food.org/food/ValueSet/hot-food',
              'http://food.org/food/ValueSet/cold-food'
            ]
          }
        ]
      }
    });
  });

  it('should export a value set that includes a component from a value set with a version', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const component = new ValueSetConceptComponentRule(true);
    component.from = {
      valueSets: ['http://food.org/food/ValueSet/hot-food|1.2.3']
    };
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'DinnerVS',
      name: 'DinnerVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      status: 'draft',
      compose: {
        include: [
          {
            valueSet: ['http://food.org/food/ValueSet/hot-food|1.2.3']
          }
        ]
      }
    });
  });

  it('should export a value set that includes a component from a named value set', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const component = new ValueSetConceptComponentRule(true);
    component.from = {
      valueSets: ['HotFoodVS', 'ColdFoodVS']
    };
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);
    const hotFoodVS = new FshValueSet('HotFoodVS');
    hotFoodVS.id = 'hot-food';
    doc.valueSets.set(hotFoodVS.name, hotFoodVS);
    const coldFoodVS = new FshValueSet('ColdFoodVS');
    coldFoodVS.id = 'cold-food';
    doc.valueSets.set(coldFoodVS.name, coldFoodVS);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(3);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'DinnerVS',
      name: 'DinnerVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      status: 'draft',
      compose: {
        include: [
          {
            valueSet: [
              'http://hl7.org/fhir/us/minimal/ValueSet/hot-food',
              'http://hl7.org/fhir/us/minimal/ValueSet/cold-food'
            ]
          }
        ]
      }
    });
  });

  it('should export a value set that includes a concept component with at least one concept', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const component = new ValueSetConceptComponentRule(true);
    component.from = { system: 'http://food.org/food' };
    component.concepts.push(
      new FshCode('Pizza', 'http://food.org/food', 'Delicious pizza to share.')
    );
    component.concepts.push(
      new FshCode('Salad', 'http://food.org/food', 'Plenty of fresh vegetables.')
    );
    component.concepts.push(new FshCode('Mulch', 'http://food.org/food'));
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'DinnerVS',
      name: 'DinnerVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      status: 'draft',
      compose: {
        include: [
          {
            system: 'http://food.org/food',
            concept: [
              { code: 'Pizza', display: 'Delicious pizza to share.' },
              { code: 'Salad', display: 'Plenty of fresh vegetables.' },
              { code: 'Mulch' }
            ]
          }
        ]
      }
    });
  });

  it('should export a value set that includes a concept component from a local complete code system name with at least one concept', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const component = new ValueSetConceptComponentRule(true);
    component.from = { system: 'FoodCS' };
    component.concepts.push(new FshCode('Pizza', 'FoodCS', 'Delicious pizza to share.'));
    component.concepts.push(new FshCode('Salad', 'FoodCS', 'Plenty of fresh vegetables.'));
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);
    const foodCS = new FshCodeSystem('FoodCS');
    foodCS.id = 'food';
    foodCS.rules.push(new ConceptRule('Pizza', 'Delicious pizza to share.'));
    foodCS.rules.push(new ConceptRule('Salad', 'Plenty of fresh vegetables.'));
    doc.codeSystems.set(foodCS.name, foodCS);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      name: 'DinnerVS',
      id: 'DinnerVS',
      status: 'draft',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      compose: {
        include: [
          {
            system: 'http://hl7.org/fhir/us/minimal/CodeSystem/food',
            concept: [
              { code: 'Pizza', display: 'Delicious pizza to share.' },
              { code: 'Salad', display: 'Plenty of fresh vegetables.' }
            ]
          }
        ]
      }
    });
    expect(loggerSpy.getAllMessages('error')).toHaveLength(0);
  });

  it('should export a value set that includes a concept component from a local complete code system name with concepts added by CaretValueRules', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const component = new ValueSetConceptComponentRule(true);
    component.from = { system: 'FoodCS' };
    component.concepts.push(new FshCode('Pizza', 'FoodCS', 'Delicious pizza to share.'));
    component.concepts.push(new FshCode('Salad', 'FoodCS', 'Plenty of fresh vegetables.'));
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);
    const foodCS = new FshCodeSystem('FoodCS');
    foodCS.id = 'food';
    const pizzaCode = new CaretValueRule('');
    pizzaCode.caretPath = 'concept[0].code';
    pizzaCode.value = new FshCode('Pizza');
    const pizzaDisplay = new CaretValueRule('');
    pizzaDisplay.caretPath = 'concept[0].display';
    pizzaDisplay.value = 'Delicious pizza to share.';
    const saladCode = new CaretValueRule('');
    saladCode.caretPath = 'concept[ 1 ].code';
    saladCode.value = new FshCode('Salad');
    const saladDisplay = new CaretValueRule('');
    saladDisplay.caretPath = 'concept[1].display';
    saladDisplay.value = 'Plenty of fresh vegetables.';
    foodCS.rules.push(pizzaCode, pizzaDisplay, saladCode, saladDisplay);
    doc.codeSystems.set(foodCS.name, foodCS);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      name: 'DinnerVS',
      id: 'DinnerVS',
      status: 'draft',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      compose: {
        include: [
          {
            system: 'http://hl7.org/fhir/us/minimal/CodeSystem/food',
            concept: [
              { code: 'Pizza', display: 'Delicious pizza to share.' },
              { code: 'Salad', display: 'Plenty of fresh vegetables.' }
            ]
          }
        ]
      }
    });
    expect(loggerSpy.getAllMessages('error')).toHaveLength(0);
  });

  it('should export a value set that includes a concept component from a local complete code system name with at least one concept added by a RuleSet', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const component = new ValueSetConceptComponentRule(true);
    component.from = { system: 'FoodCS' };
    component.concepts.push(new FshCode('Pizza', 'FoodCS', 'Delicious pizza to share.'));
    component.concepts.push(new FshCode('Salad', 'FoodCS', 'Plenty of fresh vegetables.'));
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);

    const ruleSet = new RuleSet('ExtraFoodRules');
    ruleSet.rules.push(new ConceptRule('Salad', 'Plenty of fresh vegetables.'));
    doc.ruleSets.set(ruleSet.name, ruleSet);

    const foodCS = new FshCodeSystem('FoodCS');
    foodCS.id = 'food';
    foodCS.rules.push(new ConceptRule('Pizza', 'Delicious pizza to share.'));
    foodCS.rules.push(new ConceptRule('Fruit', 'Get that good fruit.'));
    const insertRule = new InsertRule('');
    insertRule.ruleSet = 'ExtraFoodRules';
    foodCS.rules.push(insertRule);
    doc.codeSystems.set(foodCS.name, foodCS);

    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      name: 'DinnerVS',
      id: 'DinnerVS',
      status: 'draft',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      compose: {
        include: [
          {
            system: 'http://hl7.org/fhir/us/minimal/CodeSystem/food',
            concept: [
              { code: 'Pizza', display: 'Delicious pizza to share.' },
              { code: 'Salad', display: 'Plenty of fresh vegetables.' }
            ]
          }
        ]
      }
    });
    expect(loggerSpy.getAllMessages('error')).toHaveLength(0);
  });

  it('should export a value set that includes a concept component from a local complete CodeSystem instance name with at least one concept', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const component = new ValueSetConceptComponentRule(true);
    component.from = { system: 'FoodCS' };
    component.concepts.push(new FshCode('Pizza', 'FoodCS', 'Delicious pizza to share.'));
    component.concepts.push(new FshCode('Salad', 'FoodCS', 'Plenty of fresh vegetables.'));
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);
    const foodCS = new Instance('FoodCS');
    foodCS.instanceOf = 'CodeSystem';
    foodCS.usage = 'Definition';
    const urlRule = new AssignmentRule('url');
    urlRule.value = 'http://hl7.org/fhir/us/minimal/Instance/food';
    const contentRule = new AssignmentRule('content');
    contentRule.value = new FshCode('supplement');
    const pizzaCode = new AssignmentRule('concept[0].code');
    pizzaCode.value = new FshCode('Pizza');
    const saladCode = new AssignmentRule('concept[1].code');
    saladCode.value = new FshCode('Salad');
    foodCS.rules.push(urlRule, contentRule, pizzaCode, saladCode);
    doc.instances.set(foodCS.name, foodCS);

    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      name: 'DinnerVS',
      id: 'DinnerVS',
      status: 'draft',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      compose: {
        include: [
          {
            system: 'http://hl7.org/fhir/us/minimal/Instance/food',
            concept: [
              { code: 'Pizza', display: 'Delicious pizza to share.' },
              { code: 'Salad', display: 'Plenty of fresh vegetables.' }
            ]
          }
        ]
      }
    });
    expect(loggerSpy.getAllMessages('error')).toHaveLength(0);
  });

  it('should export a value set that includes a concept component from a local complete CodeSystem instance name with at least one concept added by a RuleSet', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const component = new ValueSetConceptComponentRule(true);
    component.from = { system: 'FoodCS' };
    component.concepts.push(new FshCode('Pizza', 'FoodCS', 'Delicious pizza to share.'));
    component.concepts.push(new FshCode('Salad', 'FoodCS', 'Plenty of fresh vegetables.'));
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);

    const ruleSet = new RuleSet('ExtraFoodRules');
    const saladCode = new AssignmentRule('concept[+].code');
    saladCode.value = new FshCode('Salad');
    ruleSet.rules.push(saladCode);
    doc.ruleSets.set(ruleSet.name, ruleSet);

    const foodCS = new Instance('FoodCS');
    foodCS.instanceOf = 'CodeSystem';
    foodCS.usage = 'Definition';
    const urlRule = new AssignmentRule('url');
    urlRule.value = 'http://hl7.org/fhir/us/minimal/Instance/food';
    const contentRule = new AssignmentRule('content');
    contentRule.value = new FshCode('complete');
    const pizzaCode = new AssignmentRule('concept[0].code');
    pizzaCode.value = new FshCode('Pizza');
    const fruitCode = new AssignmentRule('concept[1].code');
    fruitCode.value = new FshCode('Fruit');
    const insertRule = new InsertRule('');
    insertRule.ruleSet = 'ExtraFoodRules';
    foodCS.rules.push(urlRule, contentRule, pizzaCode, fruitCode, insertRule);
    doc.instances.set(foodCS.name, foodCS);

    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      name: 'DinnerVS',
      id: 'DinnerVS',
      status: 'draft',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      compose: {
        include: [
          {
            system: 'http://hl7.org/fhir/us/minimal/Instance/food',
            concept: [
              { code: 'Pizza', display: 'Delicious pizza to share.' },
              { code: 'Salad', display: 'Plenty of fresh vegetables.' }
            ]
          }
        ]
      }
    });
    expect(loggerSpy.getAllMessages('error')).toHaveLength(0);
  });

  it('should export a value set that includes a concept component from a local incomplete CodeSystem when the concept is not in the system', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const component = new ValueSetConceptComponentRule(true);
    component.from = { system: 'FoodCS' };
    component.concepts.push(new FshCode('Pizza', 'FoodCS', 'Delicious pizza to share.'));
    component.concepts.push(new FshCode('Salad', 'FoodCS', 'Plenty of fresh vegetables.'));
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);
    const foodCS = new FshCodeSystem('FoodCS');
    foodCS.id = 'food';
    foodCS.rules.push(new ConceptRule('Pizza', 'Delicious pizza to share.'));
    const contentRule = new CaretValueRule('');
    contentRule.caretPath = 'content';
    contentRule.value = new FshCode('fragment');
    foodCS.rules.push(contentRule);
    doc.codeSystems.set(foodCS.name, foodCS);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      name: 'DinnerVS',
      id: 'DinnerVS',
      status: 'draft',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      compose: {
        include: [
          {
            system: 'http://hl7.org/fhir/us/minimal/CodeSystem/food',
            concept: [
              { code: 'Pizza', display: 'Delicious pizza to share.' },
              { code: 'Salad', display: 'Plenty of fresh vegetables.' }
            ]
          }
        ]
      }
    });
    expect(loggerSpy.getAllMessages('error')).toHaveLength(0);
  });

  it('should export a value set that includes a concept component from a local incomplete CodeSystem instance when the concept is not in the system', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const component = new ValueSetConceptComponentRule(true);
    component.from = { system: 'FoodCS' };
    component.concepts.push(new FshCode('Pizza', 'FoodCS', 'Delicious pizza to share.'));
    component.concepts.push(new FshCode('Salad', 'FoodCS', 'Plenty of fresh vegetables.'));
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);
    const foodCS = new Instance('FoodCS');
    foodCS.instanceOf = 'CodeSystem';
    foodCS.usage = 'Definition';
    const urlRule = new AssignmentRule('url');
    urlRule.value = 'http://hl7.org/fhir/us/minimal/Instance/food';
    const contentRule = new AssignmentRule('content');
    contentRule.value = new FshCode('supplement');
    const pizzaCode = new AssignmentRule('concept[0].code');
    pizzaCode.value = new FshCode('Pizza');
    foodCS.rules.push(urlRule, contentRule, pizzaCode);
    doc.instances.set(foodCS.name, foodCS);

    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      name: 'DinnerVS',
      id: 'DinnerVS',
      status: 'draft',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      compose: {
        include: [
          {
            system: 'http://hl7.org/fhir/us/minimal/Instance/food',
            concept: [
              { code: 'Pizza', display: 'Delicious pizza to share.' },
              { code: 'Salad', display: 'Plenty of fresh vegetables.' }
            ]
          }
        ]
      }
    });
    expect(loggerSpy.getAllMessages('error')).toHaveLength(0);
  });

  it('should log an error when exporting a value set that includes a concept component from a local complete code system name when the concept is not in the system', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const component = new ValueSetConceptComponentRule(true)
      .withFile('ValueSets.fsh')
      .withLocation([12, 0, 13, 22]);
    component.from = { system: 'FoodCS' };
    component.concepts.push(new FshCode('Pizza', 'FoodCS', 'Delicious pizza to share.'));
    component.concepts.push(new FshCode('Salad', 'FoodCS', 'Plenty of fresh vegetables.'));
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);
    const foodCS = new FshCodeSystem('FoodCS');
    foodCS.id = 'food';
    foodCS.rules.push(new ConceptRule('Pizza', 'Delicious pizza to share.'));
    doc.codeSystems.set(foodCS.name, foodCS);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      name: 'DinnerVS',
      id: 'DinnerVS',
      status: 'draft',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      compose: {
        include: [
          {
            system: 'http://hl7.org/fhir/us/minimal/CodeSystem/food',
            concept: [
              { code: 'Pizza', display: 'Delicious pizza to share.' },
              { code: 'Salad', display: 'Plenty of fresh vegetables.' }
            ]
          }
        ]
      }
    });
    expect(loggerSpy.getAllMessages('error')).toHaveLength(1);
    expect(loggerSpy.getLastMessage('error')).toMatch(
      /Code "Salad" is not defined for system FoodCS.*File: ValueSets\.fsh.*Line: 12 - 13\D*/s
    );
  });

  it('should log an error when exporting a value set that includes a concept component from a local complete CodeSystem instance name when the concept is not in the system', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const component = new ValueSetConceptComponentRule(true)
      .withFile('ValueSets.fsh')
      .withLocation([15, 0, 16, 22]);
    component.from = { system: 'FoodCS' };
    component.concepts.push(new FshCode('Pizza', 'FoodCS', 'Delicious pizza to share.'));
    component.concepts.push(new FshCode('Salad', 'FoodCS', 'Plenty of fresh vegetables.'));
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);
    const foodCS = new Instance('FoodCS');
    foodCS.instanceOf = 'CodeSystem';
    foodCS.usage = 'Definition';
    const urlRule = new AssignmentRule('url');
    urlRule.value = 'http://hl7.org/fhir/us/minimal/Instance/food';
    const contentRule = new AssignmentRule('content');
    contentRule.value = new FshCode('complete');
    const pizzaCode = new AssignmentRule('concept[0].code');
    pizzaCode.value = new FshCode('Pizza');
    const fruitCode = new AssignmentRule('concept[1].code');
    fruitCode.value = new FshCode('Fruit');
    foodCS.rules.push(urlRule, contentRule, pizzaCode, fruitCode);
    doc.instances.set(foodCS.name, foodCS);

    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      name: 'DinnerVS',
      id: 'DinnerVS',
      status: 'draft',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      compose: {
        include: [
          {
            system: 'http://hl7.org/fhir/us/minimal/Instance/food',
            concept: [
              { code: 'Pizza', display: 'Delicious pizza to share.' },
              { code: 'Salad', display: 'Plenty of fresh vegetables.' }
            ]
          }
        ]
      }
    });
    expect(loggerSpy.getAllMessages('error')).toHaveLength(1);
    expect(loggerSpy.getLastMessage('error')).toMatch(
      /Code "Salad" is not defined for system FoodCS.*File: ValueSets\.fsh.*Line: 15 - 16\D*/s
    );
  });

  it('should log an error when exporting a value set that includes a concept component from a local complete code system url when the concept is not in the system', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const component = new ValueSetConceptComponentRule(true)
      .withFile('ValueSets.fsh')
      .withLocation([12, 0, 13, 22]);
    component.from = { system: 'FoodCS' };
    component.concepts.push(
      new FshCode('Pizza', 'http://food.org/food', 'Delicious pizza to share.')
    );
    component.concepts.push(
      new FshCode('Salad', 'http://food.org/food', 'Plenty of fresh vegetables.')
    );
    component.concepts.push(
      new FshCode('Mulch', 'http://food.org/food', 'Somebody likes to eat mulch.')
    );
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);
    const foodCS = new FshCodeSystem('FoodCS');
    foodCS.id = 'food';
    const systemUrl = new CaretValueRule('');
    systemUrl.caretPath = 'url';
    systemUrl.value = 'http://food.org/food';
    foodCS.rules.push(systemUrl);
    foodCS.rules.push(new ConceptRule('Pizza', 'Delicious pizza to share.'));
    doc.codeSystems.set(foodCS.name, foodCS);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      name: 'DinnerVS',
      id: 'DinnerVS',
      status: 'draft',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      compose: {
        include: [
          {
            system: 'http://food.org/food',
            concept: [
              { code: 'Pizza', display: 'Delicious pizza to share.' },
              { code: 'Salad', display: 'Plenty of fresh vegetables.' },
              { code: 'Mulch', display: 'Somebody likes to eat mulch.' }
            ]
          }
        ]
      }
    });
    expect(loggerSpy.getAllMessages('error')).toHaveLength(1);
    expect(loggerSpy.getLastMessage('error')).toMatch(
      /Codes "Salad", "Mulch" are not defined for system FoodCS.*File: ValueSets\.fsh.*Line: 12 - 13\D*/s
    );
  });

  it('should export a value set that includes a concept component where the concept system includes a version', () => {
    const valueSet = new FshValueSet('BreakfastVS');
    const toastComponent = new ValueSetConceptComponentRule(true);
    toastComponent.from = { system: 'http://food.org/food|2.0.1' };
    toastComponent.concepts.push(new FshCode('Toast', 'http://food.org/food|2.0.1'));
    valueSet.rules.push(toastComponent);
    const juiceComponent = new ValueSetConceptComponentRule(true);
    juiceComponent.from = { system: 'http://food.org/beverage|1.1|x' };
    juiceComponent.concepts.push(new FshCode('Orange juice', 'http://food.org/beverage|1.1|x'));
    valueSet.rules.push(juiceComponent);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'BreakfastVS',
      name: 'BreakfastVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/BreakfastVS',
      status: 'draft',
      compose: {
        include: [
          {
            system: 'http://food.org/food',
            concept: [{ code: 'Toast' }],
            version: '2.0.1'
          },
          {
            system: 'http://food.org/beverage',
            concept: [{ code: 'Orange juice' }],
            version: '1.1|x'
          }
        ]
      }
    });
  });

  it('should export a value set that includes a filter component with a regex filter', () => {
    const valueSet = new FshValueSet('BreakfastVS');
    const component = new ValueSetFilterComponentRule(true);
    component.from = { system: 'http://food.org/food' };
    component.filters.push({
      property: 'display',
      operator: VsOperator.REGEX,
      value: /pancakes|flapjacks/
    });
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'BreakfastVS',
      name: 'BreakfastVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/BreakfastVS',
      status: 'draft',
      compose: {
        include: [
          {
            system: 'http://food.org/food',
            filter: [
              {
                property: 'display',
                op: 'regex',
                value: 'pancakes|flapjacks'
              }
            ]
          }
        ]
      }
    });
  });

  it('should export a value set that includes a filter component with a code filter', () => {
    const valueSet = new FshValueSet('BreakfastVS');
    const component = new ValueSetFilterComponentRule(true);
    component.from = { system: 'http://food.org/food' };
    component.filters.push({
      property: 'concept',
      operator: VsOperator.DESCENDENT_OF,
      value: new FshCode('Potatoes', 'http://food.org/food')
    });
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'BreakfastVS',
      name: 'BreakfastVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/BreakfastVS',
      status: 'draft',
      compose: {
        include: [
          {
            system: 'http://food.org/food',
            filter: [
              {
                property: 'concept',
                op: 'descendent-of',
                value: 'Potatoes'
              }
            ]
          }
        ]
      }
    });
  });

  it('should export a value set that includes a filter component with a code filter where the value is from a local complete system', () => {
    const valueSet = new FshValueSet('BreakfastVS');
    const component = new ValueSetFilterComponentRule(true);
    component.from = { system: 'FoodCS' };
    component.filters.push({
      property: 'concept',
      operator: VsOperator.GENERALIZES,
      value: new FshCode('Pizza', 'FoodCS')
    });
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);

    const foodCS = new FshCodeSystem('FoodCS');
    foodCS.id = 'food';
    foodCS.rules.push(new ConceptRule('Pizza', 'Delicious pizza to share.'));
    doc.codeSystems.set(foodCS.name, foodCS);

    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'BreakfastVS',
      name: 'BreakfastVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/BreakfastVS',
      status: 'draft',
      compose: {
        include: [
          {
            system: 'http://hl7.org/fhir/us/minimal/CodeSystem/food',
            filter: [
              {
                property: 'concept',
                op: 'generalizes',
                value: 'Pizza'
              }
            ]
          }
        ]
      }
    });
    expect(loggerSpy.getAllMessages('error')).toHaveLength(0);
  });

  it('should export a value set that includes a filter component with a code filter where the value is from a local incomplete system and the code is not in the system', () => {
    const valueSet = new FshValueSet('BreakfastVS');
    const component = new ValueSetFilterComponentRule(true);
    component.from = { system: 'FoodCS' };
    component.filters.push({
      property: 'concept',
      operator: VsOperator.GENERALIZES,
      value: new FshCode('Cookie', 'FoodCS')
    });
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);

    const foodCS = new FshCodeSystem('FoodCS');
    foodCS.id = 'food';
    foodCS.rules.push(new ConceptRule('Pizza', 'Delicious pizza to share.'));
    const contentRule = new CaretValueRule('');
    contentRule.caretPath = 'content';
    contentRule.value = new FshCode('fragment');
    foodCS.rules.push(contentRule);
    doc.codeSystems.set(foodCS.name, foodCS);

    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'BreakfastVS',
      name: 'BreakfastVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/BreakfastVS',
      status: 'draft',
      compose: {
        include: [
          {
            system: 'http://hl7.org/fhir/us/minimal/CodeSystem/food',
            filter: [
              {
                property: 'concept',
                op: 'generalizes',
                value: 'Cookie'
              }
            ]
          }
        ]
      }
    });
    expect(loggerSpy.getAllMessages('error')).toHaveLength(0);
  });

  it('should export a value set that includes a filter component with a code filter where the value is from a local complete Instance of CodeSystem', () => {
    const valueSet = new FshValueSet('BreakfastVS');
    const component = new ValueSetFilterComponentRule(true);
    component.from = { system: 'FoodCS' };
    component.filters.push({
      property: 'concept',
      operator: VsOperator.GENERALIZES,
      value: new FshCode('Pizza', 'FoodCS')
    });
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);

    const foodCS = new Instance('FoodCS');
    foodCS.instanceOf = 'CodeSystem';
    foodCS.usage = 'Definition';
    const urlRule = new AssignmentRule('url');
    urlRule.value = 'http://hl7.org/fhir/us/minimal/Instance/food';
    const contentRule = new AssignmentRule('content');
    contentRule.value = new FshCode('complete');
    const pizzaCode = new AssignmentRule('concept[0].code');
    pizzaCode.value = new FshCode('Pizza');
    const fruitCode = new AssignmentRule('concept[1].code');
    fruitCode.value = new FshCode('Fruit');
    foodCS.rules.push(urlRule, contentRule, pizzaCode, fruitCode);
    doc.instances.set(foodCS.name, foodCS);

    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'BreakfastVS',
      name: 'BreakfastVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/BreakfastVS',
      status: 'draft',
      compose: {
        include: [
          {
            system: 'http://hl7.org/fhir/us/minimal/Instance/food',
            filter: [
              {
                property: 'concept',
                op: 'generalizes',
                value: 'Pizza'
              }
            ]
          }
        ]
      }
    });
    expect(loggerSpy.getAllMessages('error')).toHaveLength(0);
  });

  it('should export a value set that includes a filter component with a code filter where the value is from a local incomplete Instance of CodeSystem and the code is not in the system', () => {
    const valueSet = new FshValueSet('BreakfastVS');
    const component = new ValueSetFilterComponentRule(true);
    component.from = { system: 'FoodCS' };
    component.filters.push({
      property: 'concept',
      operator: VsOperator.GENERALIZES,
      value: new FshCode('Cookie', 'FoodCS')
    });
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);

    const foodCS = new Instance('FoodCS');
    foodCS.instanceOf = 'CodeSystem';
    foodCS.usage = 'Definition';
    const urlRule = new AssignmentRule('url');
    urlRule.value = 'http://hl7.org/fhir/us/minimal/Instance/food';
    const contentRule = new AssignmentRule('content');
    contentRule.value = new FshCode('example');
    const pizzaCode = new AssignmentRule('concept[0].code');
    pizzaCode.value = new FshCode('Pizza');
    const fruitCode = new AssignmentRule('concept[1].code');
    fruitCode.value = new FshCode('Fruit');
    foodCS.rules.push(urlRule, contentRule, pizzaCode, fruitCode);
    doc.instances.set(foodCS.name, foodCS);

    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'BreakfastVS',
      name: 'BreakfastVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/BreakfastVS',
      status: 'draft',
      compose: {
        include: [
          {
            system: 'http://hl7.org/fhir/us/minimal/Instance/food',
            filter: [
              {
                property: 'concept',
                op: 'generalizes',
                value: 'Cookie'
              }
            ]
          }
        ]
      }
    });
    expect(loggerSpy.getAllMessages('error')).toHaveLength(0);
  });

  it('should log an error when exporting a value set that includes a filter component with a code filter where the value is from a local complete system, but is not present in the system', () => {
    const valueSet = new FshValueSet('BreakfastVS');
    const component = new ValueSetFilterComponentRule(true)
      .withFile('Breakfast.fsh')
      .withLocation([8, 0, 10, 22]);
    component.from = { system: 'FoodCS' };
    component.filters.push({
      property: 'concept',
      operator: VsOperator.GENERALIZES,
      value: new FshCode('Potato', 'FoodCS')
    });
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);

    const foodCS = new FshCodeSystem('FoodCS');
    foodCS.id = 'food';
    foodCS.rules.push(new ConceptRule('Pizza', 'Delicious pizza to share.'));
    doc.codeSystems.set(foodCS.name, foodCS);

    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'BreakfastVS',
      name: 'BreakfastVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/BreakfastVS',
      status: 'draft',
      compose: {
        include: [
          {
            system: 'http://hl7.org/fhir/us/minimal/CodeSystem/food',
            filter: [
              {
                property: 'concept',
                op: 'generalizes',
                value: 'Potato'
              }
            ]
          }
        ]
      }
    });
    expect(loggerSpy.getAllMessages('error')).toHaveLength(1);
    expect(loggerSpy.getLastMessage('error')).toMatch(
      /Code "Potato" is not defined for system FoodCS.*File: Breakfast\.fsh.*Line: 8 - 10\D*/s
    );
  });

  it('should log an error when exporting a value set that includes a filter component with a code filter where the value is from a local complete Instance of CodeSystem, but is not present in the system', () => {
    const valueSet = new FshValueSet('BreakfastVS');
    const component = new ValueSetFilterComponentRule(true)
      .withFile('Breakfast.fsh')
      .withLocation([9, 0, 12, 22]);
    component.from = { system: 'FoodCS' };
    component.filters.push({
      property: 'concept',
      operator: VsOperator.GENERALIZES,
      value: new FshCode('Potato', 'FoodCS')
    });
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);

    const foodCS = new Instance('FoodCS');
    foodCS.instanceOf = 'CodeSystem';
    foodCS.usage = 'Definition';
    const urlRule = new AssignmentRule('url');
    urlRule.value = 'http://hl7.org/fhir/us/minimal/Instance/food';
    const contentRule = new AssignmentRule('content');
    contentRule.value = new FshCode('complete');
    const pizzaCode = new AssignmentRule('concept[0].code');
    pizzaCode.value = new FshCode('Pizza');
    const fruitCode = new AssignmentRule('concept[1].code');
    fruitCode.value = new FshCode('Fruit');
    foodCS.rules.push(urlRule, contentRule, pizzaCode, fruitCode);
    doc.instances.set(foodCS.name, foodCS);

    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'BreakfastVS',
      name: 'BreakfastVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/BreakfastVS',
      status: 'draft',
      compose: {
        include: [
          {
            system: 'http://hl7.org/fhir/us/minimal/Instance/food',
            filter: [
              {
                property: 'concept',
                op: 'generalizes',
                value: 'Potato'
              }
            ]
          }
        ]
      }
    });
    expect(loggerSpy.getAllMessages('error')).toHaveLength(1);
    expect(loggerSpy.getLastMessage('error')).toMatch(
      /Code "Potato" is not defined for system FoodCS.*File: Breakfast\.fsh.*Line: 9 - 12\D*/s
    );
  });

  it('should export a value set that includes a filter component with a string filter', () => {
    const valueSet = new FshValueSet('BreakfastVS');
    const component = new ValueSetFilterComponentRule(true);
    component.from = { system: 'http://food.org/food' };
    component.filters.push({
      property: 'version',
      operator: VsOperator.EQUALS,
      value: '3.0.0'
    });
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'BreakfastVS',
      name: 'BreakfastVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/BreakfastVS',
      status: 'draft',
      compose: {
        include: [
          {
            system: 'http://food.org/food',
            filter: [
              {
                property: 'version',
                op: '=',
                value: '3.0.0'
              }
            ]
          }
        ]
      }
    });
  });

  it('should export a value set that excludes a component', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const includedComponent = new ValueSetFilterComponentRule(true);
    includedComponent.from = {
      system: 'http://food.org/food',
      valueSets: ['http://food.org/food/ValueSet/baked', 'http://food.org/food/ValueSet/grilled']
    };
    const excludedComponent = new ValueSetConceptComponentRule(false);
    excludedComponent.from = { system: 'http://food.org/food' };
    excludedComponent.concepts.push(
      new FshCode('Cake', 'http://food.org/food', 'A delicious treat for special occasions.')
    );
    valueSet.rules.push(includedComponent);
    valueSet.rules.push(excludedComponent);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'DinnerVS',
      name: 'DinnerVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      status: 'draft',
      compose: {
        include: [
          {
            system: 'http://food.org/food',
            valueSet: [
              'http://food.org/food/ValueSet/baked',
              'http://food.org/food/ValueSet/grilled'
            ]
          }
        ],
        exclude: [
          {
            system: 'http://food.org/food',
            concept: [
              {
                code: 'Cake',
                display: 'A delicious treat for special occasions.'
              }
            ]
          }
        ]
      }
    });
  });

  it('should log a message when a value set has a logical definition without inclusions', () => {
    const valueSet = new FshValueSet('BreakfastVS')
      .withFile('Breakfast.fsh')
      .withLocation([2, 8, 4, 25]);
    const candyFilter = new ValueSetFilterComponentRule(false);
    candyFilter.from = { valueSets: ['CandyVS'] };
    valueSet.rules.push(candyFilter);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(0);
    expect(loggerSpy.getLastMessage('error')).toMatch(/File: Breakfast\.fsh.*Line: 2 - 4\D*/s);
  });

  it('should log a message when a value set from system is not a URI', () => {
    const valueSet = new FshValueSet('BreakfastVS')
      .withFile('Breakfast.fsh')
      .withLocation([2, 8, 4, 25]);
    const component = new ValueSetComponentRule(true);
    component.from = { system: 'notAUri' };
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(0);
    expect(loggerSpy.getLastMessage('error')).toMatch(
      /notAUri.*File: Breakfast\.fsh.*Line: 2 - 4\D*/s
    );
  });

  it('should log a message when a value set from is not a URI', () => {
    const valueSet = new FshValueSet('BreakfastVS')
      .withFile('Breakfast.fsh')
      .withLocation([2, 8, 4, 25]);
    const component = new ValueSetComponentRule(true);
    component.from = { valueSets: ['notAUri'] };
    valueSet.rules.push(component);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(0);
    expect(loggerSpy.getLastMessage('error')).toMatch(
      /notAUri.*File: Breakfast\.fsh.*Line: 2 - 4\D*/s
    );
  });

  it('should log a message and not add the concept again when a specific concept is included more than once', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const pizzaComponent = new ValueSetConceptComponentRule(true)
      .withFile('Dinner.fsh')
      .withLocation([2, 0, 2, 15]);
    pizzaComponent.from = { system: 'http://food.org/food' };
    pizzaComponent.concepts.push(
      new FshCode('Pizza', 'http://food.org/food', 'Delicious pizza to share.')
    );
    const multiComponent = new ValueSetConceptComponentRule(true)
      .withFile('Dinner.fsh')
      .withLocation([3, 0, 4, 16]);
    multiComponent.from = { system: 'http://food.org/food' };
    multiComponent.concepts.push(
      new FshCode('Pizza', 'http://food.org/food', 'Delicious pizza to share.'),
      new FshCode('Salad', 'http://food.org/food', 'Plenty of fresh vegetables.'),
      new FshCode('Toast', 'http://food.org/food')
    );
    const toastComponent = new ValueSetConceptComponentRule(true)
      .withFile('Dinner.fsh')
      .withLocation([5, 0, 5, 17]);
    toastComponent.from = { system: 'http://food.org/food|2.0.1' };
    toastComponent.concepts.push(new FshCode('Toast', 'http://food.org/food|2.0.1'));
    const saladComponent = new ValueSetConceptComponentRule(true)
      .withFile('Dinner.fsh')
      .withLocation([6, 0, 6, 18]);
    saladComponent.from = { system: 'http://food.org/food' };
    saladComponent.concepts.push(
      new FshCode('Salad', 'http://food.org/food', 'Plenty of fresh vegetables.')
    );
    const versionMultiComponent = new ValueSetConceptComponentRule(true)
      .withFile('Dinner.fsh')
      .withLocation([7, 0, 9, 19]);
    versionMultiComponent.from = { system: 'http://food.org/food|2.0.1' };
    versionMultiComponent.concepts.push(
      new FshCode('Toast', 'http://food.org/food|2.0.1'),
      new FshCode('Waffles', 'http://food.org/food|2.0.1')
    );
    valueSet.rules.push(
      pizzaComponent,
      multiComponent,
      toastComponent,
      saladComponent,
      versionMultiComponent
    );
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    const inclusions = exported[0].compose.include;
    expect(inclusions.length).toBe(2);
    expect(inclusions[0]).toEqual({
      system: 'http://food.org/food',
      concept: [
        {
          code: 'Pizza',
          display: 'Delicious pizza to share.'
        },
        {
          code: 'Salad',
          display: 'Plenty of fresh vegetables.'
        },
        {
          code: 'Toast'
        }
      ]
    });
    expect(inclusions[1]).toEqual({
      system: 'http://food.org/food',
      version: '2.0.1',
      concept: [
        {
          code: 'Toast'
        },
        {
          code: 'Waffles'
        }
      ]
    });
    const warnings = loggerSpy.getAllMessages('warn');
    expect(warnings.length).toBe(3);
    expect(warnings[0]).toMatch(
      /ValueSet DinnerVS already includes http:\/\/food\.org\/food#Pizza.*File: Dinner\.fsh.*Line: 3 - 4\D*/s
    );
    expect(warnings[1]).toMatch(
      /ValueSet DinnerVS already includes http:\/\/food\.org\/food#Salad.*File: Dinner\.fsh.*Line: 6\D*/s
    );
    expect(warnings[2]).toMatch(
      /ValueSet DinnerVS already includes http:\/\/food\.org\/food\|2\.0\.1#Toast.*File: Dinner\.fsh.*Line: 7 - 9\D*/s
    );
  });

  // CaretValueRules
  it('should apply a CaretValueRule', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const rule = new CaretValueRule('');
    rule.caretPath = 'publisher';
    rule.value = 'Carrots';
    valueSet.rules.push(rule);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'DinnerVS',
      name: 'DinnerVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      status: 'draft',
      publisher: 'Carrots'
    });
  });

  it('should apply a CaretValueRule with soft indexing', () => {
    const valueSet = new FshValueSet('AppleVS');
    const caretRule1 = new CaretValueRule('');
    caretRule1.caretPath = 'contact[+].name';
    caretRule1.value = 'Johnny Appleseed';
    valueSet.rules.push(caretRule1);
    const caretRule2 = new CaretValueRule('');
    caretRule2.caretPath = 'contact[=].telecom[+].rank';
    caretRule2.value = 1;
    valueSet.rules.push(caretRule2);
    const caretRule3 = new CaretValueRule('');
    caretRule3.caretPath = 'contact[=].telecom[=].value';
    caretRule3.value = 'email.email@email.com';
    valueSet.rules.push(caretRule3);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'AppleVS',
      name: 'AppleVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/AppleVS',
      status: 'draft',
      contact: [
        {
          name: 'Johnny Appleseed',
          telecom: [
            {
              rank: 1,
              value: 'email.email@email.com'
            }
          ]
        }
      ]
    });
  });

  it('should apply a CaretValueRule with extension slices in the correct order', () => {
    const valueSet = new FshValueSet('SliceVS');
    const caretRule1 = new CaretValueRule('');
    caretRule1.caretPath =
      'extension[http://hl7.org/fhir/StructureDefinition/structuredefinition-fmm].valueInteger';
    caretRule1.value = 0;
    const caretRule2 = new CaretValueRule('');
    caretRule2.caretPath =
      'extension[http://hl7.org/fhir/StructureDefinition/structuredefinition-standards-status].valueCode';
    caretRule2.value = new FshCode('draft');
    valueSet.rules.push(caretRule1, caretRule2);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0].extension).toEqual([
      {
        url: 'http://hl7.org/fhir/StructureDefinition/structuredefinition-fmm',
        valueInteger: 0
      },
      {
        url: 'http://hl7.org/fhir/StructureDefinition/structuredefinition-standards-status',
        valueCode: 'draft'
      }
    ]);
    expect(loggerSpy.getAllMessages('error')).toHaveLength(0);
    expect(loggerSpy.getAllMessages('warn')).toHaveLength(0);
  });

  it('should apply a CaretValueRule that assigns an inline Instance', () => {
    // ValueSet: BreakfastVS
    // Title: "Breakfast Values"
    // * ^contact = BreakfastMachine
    const valueSet = new FshValueSet('BreakfastVS');
    valueSet.title = 'Breakfast Values';
    const contactRule = new CaretValueRule('');
    contactRule.caretPath = 'contact';
    contactRule.value = 'BreakfastMachine';
    contactRule.isInstance = true;
    valueSet.rules.push(contactRule);
    doc.valueSets.set(valueSet.name, valueSet);
    // Instance: BreakfastMachine
    // InstanceOf: ContactDetail
    // Usage: #inline
    // * name = "The Breakfast Machine"
    const breakfastMachine = new Instance('BreakfastMachine');
    breakfastMachine.instanceOf = 'ContactDetail';
    breakfastMachine.usage = 'Inline';
    const breakfastName = new AssignmentRule('name');
    breakfastName.value = 'The Breakfast Machine';
    breakfastMachine.rules.push(breakfastName);
    doc.instances.set(breakfastMachine.name, breakfastMachine);

    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0].contact[0]).toEqual({
      name: 'The Breakfast Machine'
    });
  });

  it('should apply a CaretValueRule that assigns an inline Instance with a numeric id', () => {
    // ValueSet: BreakfastVS
    // Title: "Breakfast Values"
    // * ^contact = 1024
    const valueSet = new FshValueSet('BreakfastVS');
    valueSet.title = 'Breakfast Values';
    const contactRule = new CaretValueRule('');
    contactRule.caretPath = 'contact';
    contactRule.value = 1024;
    contactRule.rawValue = '1024';
    valueSet.rules.push(contactRule);
    doc.valueSets.set(valueSet.name, valueSet);
    // Instance: 1024
    // InstanceOf: ContactDetail
    // Usage: #inline
    // * name = "The Breakfast Machine"
    const breakfastMachine = new Instance('1024');
    breakfastMachine.instanceOf = 'ContactDetail';
    breakfastMachine.usage = 'Inline';
    const breakfastName = new AssignmentRule('name');
    breakfastName.value = 'The Breakfast Machine';
    breakfastMachine.rules.push(breakfastName);
    doc.instances.set(breakfastMachine.name, breakfastMachine);

    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0].contact[0]).toEqual({
      name: 'The Breakfast Machine'
    });
  });

  it('should apply a CaretValueRule that assigns an inline Instance with an id that resembles a boolean', () => {
    // ValueSet: BreakfastVS
    // Title: "Breakfast Values"
    // * ^contact = false
    const valueSet = new FshValueSet('BreakfastVS');
    valueSet.title = 'Breakfast Values';
    const contactRule = new CaretValueRule('');
    contactRule.caretPath = 'contact';
    contactRule.value = false;
    contactRule.rawValue = 'false';
    valueSet.rules.push(contactRule);
    doc.valueSets.set(valueSet.name, valueSet);
    // Instance: false
    // InstanceOf: ContactDetail
    // Usage: #inline
    // * name = "The Breakfast Machine"
    const breakfastMachine = new Instance('false');
    breakfastMachine.instanceOf = 'ContactDetail';
    breakfastMachine.usage = 'Inline';
    const breakfastName = new AssignmentRule('name');
    breakfastName.value = 'The Breakfast Machine';
    breakfastMachine.rules.push(breakfastName);
    doc.instances.set(breakfastMachine.name, breakfastMachine);

    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0].contact[0]).toEqual({
      name: 'The Breakfast Machine'
    });
  });

  it('should log a message when trying to assign an Instance, but the Instance is not found', () => {
    // ValueSet: BreakfastVS
    // Title: "Breakfast Values"
    // * ^contact = BreakfastMachine
    const valueSet = new FshValueSet('BreakfastVS');
    valueSet.title = 'Breakfast Values';
    const contactRule = new CaretValueRule('')
      .withFile('ValueSets.fsh')
      .withLocation([9, 3, 9, 28]);
    contactRule.caretPath = 'contact';
    contactRule.value = 'BreakfastMachine';
    contactRule.isInstance = true;
    valueSet.rules.push(contactRule);
    doc.valueSets.set(valueSet.name, valueSet);

    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0].contact).toBeUndefined();
    expect(loggerSpy.getLastMessage('error')).toMatch(
      /Cannot find definition for Instance: BreakfastMachine. Skipping rule.*File: ValueSets\.fsh.*Line: 9\D*/s
    );
  });

  it('should log a message when trying to assign a value that is numeric and refers to an Instance, but both types are wrong', () => {
    // ValueSet: BreakfastVS
    // Title: "Breakfast Values"
    // * ^identifier = 1024
    const valueSet = new FshValueSet('BreakfastVS');
    valueSet.title = 'Breakfast Values';
    const identifierRule = new CaretValueRule('')
      .withFile('ValueSets.fsh')
      .withLocation([8, 5, 8, 29]);
    identifierRule.caretPath = 'identifier';
    identifierRule.value = 1024;
    identifierRule.rawValue = '1024';
    valueSet.rules.push(identifierRule);
    doc.valueSets.set(valueSet.name, valueSet);
    // Instance: 1024
    // InstanceOf: ContactDetail
    // Usage: #inline
    // * name = "The Breakfast Machine"
    const breakfastMachine = new Instance('1024');
    breakfastMachine.instanceOf = 'ContactDetail';
    breakfastMachine.usage = 'Inline';
    const breakfastName = new AssignmentRule('name');
    breakfastName.value = 'The Breakfast Machine';
    breakfastMachine.rules.push(breakfastName);
    doc.instances.set(breakfastMachine.name, breakfastMachine);

    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(loggerSpy.getLastMessage('error')).toMatch(
      /Cannot assign number value: 1024\. Value does not match element type: Identifier.*File: ValueSets\.fsh.*Line: 8\D*/s
    );
  });

  it('should log a message when trying to assign a value that is boolean and refers to an Instance, but both types are wrong', () => {
    // ValueSet: BreakfastVS
    // Title: "Breakfast Values"
    // * ^identifier = true
    const valueSet = new FshValueSet('BreakfastVS');
    valueSet.title = 'Breakfast Values';
    const identifierRule = new CaretValueRule('')
      .withFile('ValueSets.fsh')
      .withLocation([8, 5, 8, 29]);
    identifierRule.caretPath = 'identifier';
    identifierRule.value = true;
    identifierRule.rawValue = 'true';
    valueSet.rules.push(identifierRule);
    doc.valueSets.set(valueSet.name, valueSet);
    // Instance: true
    // InstanceOf: ContactDetail
    // Usage: #inline
    // * name = "The Breakfast Machine"
    const breakfastMachine = new Instance('true');
    breakfastMachine.instanceOf = 'ContactDetail';
    breakfastMachine.usage = 'Inline';
    const breakfastName = new AssignmentRule('name');
    breakfastName.value = 'The Breakfast Machine';
    breakfastMachine.rules.push(breakfastName);
    doc.instances.set(breakfastMachine.name, breakfastMachine);

    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(loggerSpy.getLastMessage('error')).toMatch(
      /Cannot assign boolean value: true\. Value does not match element type: Identifier.*File: ValueSets\.fsh.*Line: 8\D*/s
    );
  });

  it('should export a value set with an extension', () => {
    const valueSet = new FshValueSet('BreakfastVS');
    valueSet.title = 'Breakfast Values';
    const extensionRule = new CaretValueRule('');
    extensionRule.caretPath = 'extension[structuredefinition-fmm].valueInteger';
    extensionRule.value = 1;
    valueSet.rules.push(extensionRule);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0].extension).toContainEqual({
      url: 'http://hl7.org/fhir/StructureDefinition/structuredefinition-fmm',
      valueInteger: 1
    });
  });

  it('should log a message when applying invalid CaretValueRule', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const rule = new CaretValueRule('').withFile('InvalidValue.fsh').withLocation([6, 3, 6, 12]);
    rule.caretPath = 'publisherz';
    rule.value = true;
    valueSet.rules.push(rule);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'DinnerVS',
      name: 'DinnerVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      status: 'draft'
    });
    expect(loggerSpy.getLastMessage('error')).toMatch(/File: InvalidValue\.fsh.*Line: 6\D*/s);
  });

  it('should use the url specified in a CaretValueRule when referencing a named value set', () => {
    const lunchVS = new FshValueSet('LunchVS');
    const lunchFilterComponent = new ValueSetFilterComponentRule(true);
    lunchFilterComponent.from = {
      valueSets: ['SandwichVS']
    };
    lunchVS.rules.push(lunchFilterComponent);

    const sandwichVS = new FshValueSet('SandwichVS');
    const sandwichRule = new CaretValueRule('');
    sandwichRule.caretPath = 'url';
    sandwichRule.value = 'http://sandwich.org/ValueSet/SandwichVS';
    sandwichVS.rules.push(sandwichRule);

    doc.valueSets.set(lunchVS.name, lunchVS);
    doc.valueSets.set(sandwichVS.name, sandwichVS);

    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(2);
    expect(exported[0].compose.include[0].valueSet[0]).toBe(
      'http://sandwich.org/ValueSet/SandwichVS'
    );
  });

  it('should use the url specified in a CaretValueRule when referencing a named code system', () => {
    const lunchVS = new FshValueSet('LunchVS');
    const lunchFilterComponent = new ValueSetFilterComponentRule(true);
    lunchFilterComponent.from = {
      system: 'FoodCS'
    };
    lunchVS.rules.push(lunchFilterComponent);

    const foodCS = new FshCodeSystem('FoodCS');
    const foodRule = new CaretValueRule('');
    foodRule.caretPath = 'url';
    foodRule.value = 'http://food.net/CodeSystem/FoodCS';
    foodCS.rules.push(foodRule);

    doc.valueSets.set(lunchVS.name, lunchVS);
    doc.codeSystems.set(foodCS.name, foodCS);

    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0].compose.include[0].system).toBe('http://food.net/CodeSystem/FoodCS');
  });

  it('should apply a CaretValueRule at an included concept', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const component = new ValueSetConceptComponentRule(true);
    component.from = { system: 'http://food.org/food' };
    component.concepts.push(
      new FshCode('Pizza', 'http://food.org/food', 'Delicious pizza to share.')
    );
    component.concepts.push(
      new FshCode('Salad', 'http://food.org/food', 'Plenty of fresh vegetables.')
    );
    component.concepts.push(new FshCode('Mulch', 'http://food.org/food'));
    const designation = new CaretValueRule('');
    designation.caretPath = 'designation.value';
    designation.pathArray = ['http://food.org/food#Salad'];
    designation.value = 'ensalada';
    valueSet.rules.push(component, designation);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'DinnerVS',
      name: 'DinnerVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      status: 'draft',
      compose: {
        include: [
          {
            system: 'http://food.org/food',
            concept: [
              {
                code: 'Pizza',
                display: 'Delicious pizza to share.'
              },
              {
                code: 'Salad',
                display: 'Plenty of fresh vegetables.',
                designation: [{ value: 'ensalada' }]
              },
              { code: 'Mulch' }
            ]
          }
        ]
      }
    });
    expect(designation.isCodeCaretRule).toBeTrue();
    expect(loggerSpy.getAllMessages('error')).toHaveLength(0);
  });

  it('should apply a CaretValueRule at a concept from a code system defined in FSH identified by name', () => {
    const foodCS = new FshCodeSystem('FoodCS');
    foodCS.id = 'food';
    foodCS.rules.push(new ConceptRule('Pizza', 'Delicious pizza to share.'));
    foodCS.rules.push(new ConceptRule('Salad', 'Plenty of fresh vegetables.'));
    doc.codeSystems.set(foodCS.name, foodCS);

    const valueSet = new FshValueSet('DinnerVS');
    const component = new ValueSetConceptComponentRule(true);
    component.from = { system: 'FoodCS' };
    component.concepts.push(new FshCode('Pizza', 'FoodCS', 'Delicious pizza to share.'));
    component.concepts.push(new FshCode('Salad', 'FoodCS', 'Plenty of fresh vegetables.'));
    const designation = new CaretValueRule('');
    designation.caretPath = 'designation.value';
    designation.pathArray = ['FoodCS#Salad'];
    designation.value = 'ensalada';
    valueSet.rules.push(component, designation);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'DinnerVS',
      name: 'DinnerVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      status: 'draft',
      compose: {
        include: [
          {
            system: 'http://hl7.org/fhir/us/minimal/CodeSystem/food',
            concept: [
              {
                code: 'Pizza',
                display: 'Delicious pizza to share.'
              },
              {
                code: 'Salad',
                display: 'Plenty of fresh vegetables.',
                designation: [{ value: 'ensalada' }]
              }
            ]
          }
        ]
      }
    });
    expect(designation.isCodeCaretRule).toBeTrue();
    expect(loggerSpy.getAllMessages('error')).toHaveLength(0);
  });

  it('should apply a CaretValueRule at a concept from a code system defined in FSH identified by id', () => {
    const foodCS = new FshCodeSystem('FoodCS');
    foodCS.id = 'food';
    foodCS.rules.push(new ConceptRule('Pizza', 'Delicious pizza to share.'));
    foodCS.rules.push(new ConceptRule('Salad', 'Plenty of fresh vegetables.'));
    doc.codeSystems.set(foodCS.name, foodCS);

    const valueSet = new FshValueSet('DinnerVS');
    const component = new ValueSetConceptComponentRule(true);
    component.from = { system: 'FoodCS' };
    component.concepts.push(new FshCode('Pizza', 'FoodCS', 'Delicious pizza to share.'));
    component.concepts.push(new FshCode('Salad', 'FoodCS', 'Plenty of fresh vegetables.'));
    const designation = new CaretValueRule('');
    designation.caretPath = 'designation.value';
    designation.pathArray = ['food#Salad'];
    designation.value = 'ensalada';
    valueSet.rules.push(component, designation);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'DinnerVS',
      name: 'DinnerVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      status: 'draft',
      compose: {
        include: [
          {
            system: 'http://hl7.org/fhir/us/minimal/CodeSystem/food',
            concept: [
              {
                code: 'Pizza',
                display: 'Delicious pizza to share.'
              },
              {
                code: 'Salad',
                display: 'Plenty of fresh vegetables.',
                designation: [{ value: 'ensalada' }]
              }
            ]
          }
        ]
      }
    });
    expect(designation.isCodeCaretRule).toBeTrue();
    expect(loggerSpy.getAllMessages('error')).toHaveLength(0);
  });

  it('should apply a CaretValueRule at an excluded concept', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const included = new ValueSetConceptComponentRule(true);
    included.from = { system: 'http://food.org/food' };
    included.concepts.push(
      new FshCode('Pizza', 'http://food.org/food', 'Delicious pizza to share.')
    );
    included.concepts.push(
      new FshCode('Salad', 'http://food.org/food', 'Plenty of fresh vegetables.')
    );
    const excluded = new ValueSetConceptComponentRule(false);
    excluded.from = { system: 'http://food.org/food' };
    excluded.concepts.push(new FshCode('Mulch', 'http://food.org/food'));
    const designation = new CaretValueRule('');
    designation.caretPath = 'designation.value';
    designation.pathArray = ['http://food.org/food#Mulch'];
    designation.value = 'mantillo';
    valueSet.rules.push(included, excluded, designation);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'DinnerVS',
      name: 'DinnerVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      status: 'draft',
      compose: {
        include: [
          {
            system: 'http://food.org/food',
            concept: [
              {
                code: 'Pizza',
                display: 'Delicious pizza to share.'
              },
              {
                code: 'Salad',
                display: 'Plenty of fresh vegetables.'
              }
            ]
          }
        ],
        exclude: [
          {
            system: 'http://food.org/food',
            concept: [
              {
                code: 'Mulch',
                designation: [{ value: 'mantillo' }]
              }
            ]
          }
        ]
      }
    });
    expect(designation.isCodeCaretRule).toBeTrue();
    expect(loggerSpy.getAllMessages('error')).toHaveLength(0);
  });

  it('should apply a CaretValueRule that assigns an instance at a concept', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const component = new ValueSetConceptComponentRule(true);
    component.from = { system: 'http://food.org/food' };
    component.concepts.push(
      new FshCode('Pizza', 'http://food.org/food', 'Delicious pizza to share.')
    );
    component.concepts.push(
      new FshCode('Salad', 'http://food.org/food', 'Plenty of fresh vegetables.')
    );
    component.concepts.push(new FshCode('Mulch', 'http://food.org/food'));
    const designationValue = new CaretValueRule('');
    designationValue.caretPath = 'designation.value';
    designationValue.pathArray = ['http://food.org/food#Salad'];
    designationValue.value = 'ensalada';
    const designationExtension = new CaretValueRule('');
    designationExtension.caretPath = 'designation.extension';
    designationExtension.pathArray = ['http://food.org/food#Salad'];
    designationExtension.value = 'SomeDesignation';
    designationExtension.isInstance = true;
    valueSet.rules.push(component, designationValue, designationExtension);
    doc.valueSets.set(valueSet.name, valueSet);
    // Instance: SomeDesignation
    // InstanceOf: data-absent-reason
    // Usage: #inline
    // * valueCode = #as-text
    const designationInstance = new Instance('SomeDesignation');
    designationInstance.instanceOf = 'data-absent-reason';
    designationInstance.usage = 'Inline';
    const extensionCode = new AssignmentRule('valueCode');
    extensionCode.value = new FshCode('as-text');
    designationInstance.rules.push(extensionCode);
    doc.instances.set(designationInstance.name, designationInstance);

    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'DinnerVS',
      name: 'DinnerVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      status: 'draft',
      compose: {
        include: [
          {
            system: 'http://food.org/food',
            concept: [
              {
                code: 'Pizza',
                display: 'Delicious pizza to share.'
              },
              {
                code: 'Salad',
                display: 'Plenty of fresh vegetables.',
                designation: [
                  {
                    value: 'ensalada',
                    extension: [
                      {
                        url: 'http://hl7.org/fhir/StructureDefinition/data-absent-reason',
                        valueCode: 'as-text'
                      }
                    ]
                  }
                ]
              },
              { code: 'Mulch' }
            ]
          }
        ]
      }
    });
    expect(designationValue.isCodeCaretRule).toBeTrue();
    expect(designationExtension.isCodeCaretRule).toBeTrue();
    expect(loggerSpy.getAllMessages('error')).toHaveLength(0);
  });

  it('should log an error when a CaretValueRule is applied at a concept that is neither included nor excluded', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const component = new ValueSetConceptComponentRule(true);
    component.from = { system: 'http://food.org/food' };
    component.concepts.push(
      new FshCode('Pizza', 'http://food.org/food', 'Delicious pizza to share.')
    );
    component.concepts.push(
      new FshCode('Salad', 'http://food.org/food', 'Plenty of fresh vegetables.')
    );
    component.concepts.push(new FshCode('Mulch', 'http://food.org/food'));
    const designation = new CaretValueRule('').withFile('ValueSet.fsh').withLocation([4, 3, 4, 29]);
    designation.caretPath = 'designation.value';
    designation.pathArray = ['http://food.org/food#Bread'];
    designation.value = 'pan';
    valueSet.rules.push(component, designation);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'DinnerVS',
      name: 'DinnerVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      status: 'draft',
      compose: {
        include: [
          {
            system: 'http://food.org/food',
            concept: [
              {
                code: 'Pizza',
                display: 'Delicious pizza to share.'
              },
              {
                code: 'Salad',
                display: 'Plenty of fresh vegetables.'
              },
              { code: 'Mulch' }
            ]
          }
        ]
      }
    });
    expect(designation.isCodeCaretRule).toBeTrue();
    expect(loggerSpy.getAllMessages('error')).toHaveLength(1);
    expect(loggerSpy.getLastMessage('error')).toMatch(
      'Could not find concept http://food.org/food#Bread, skipping rule.'
    );
    expect(loggerSpy.getLastMessage('error')).toMatch(/File: ValueSet\.fsh.*Line: 4\D*/s);
  });

  it('should not throw an error when caret rules are applied to a code from a specific version of a codeSystem', () => {
    const valueSet = new FshValueSet('DinnerVS');
    const unversionedComponent = new ValueSetConceptComponentRule(true);
    unversionedComponent.from = { system: 'http://food.org/food' };
    unversionedComponent.concepts.push(
      new FshCode('Pizza', 'http://food.org/food', 'Delicious pizza to share.')
    );
    const versionComponent = new ValueSetConceptComponentRule(true);
    versionComponent.from = { system: 'http://food.org/food|2.0.1' };
    versionComponent.concepts.push(
      new FshCode('Salad', 'http://food.org/food|2.0.1', 'Plenty of fresh vegetables.')
    );
    const designationValue = new CaretValueRule('');
    designationValue.caretPath = 'designation.value';
    designationValue.pathArray = ['http://food.org/food|2.0.1#Salad'];
    designationValue.value = 'Salat';
    valueSet.rules.push(unversionedComponent, versionComponent, designationValue);
    doc.valueSets.set(valueSet.name, valueSet);
    const exported = exporter.export().valueSets;
    expect(exported.length).toBe(1);
    expect(exported[0]).toEqual({
      resourceType: 'ValueSet',
      id: 'DinnerVS',
      name: 'DinnerVS',
      url: 'http://hl7.org/fhir/us/minimal/ValueSet/DinnerVS',
      status: 'draft',
      compose: {
        include: [
          {
            system: 'http://food.org/food',
            concept: [
              {
                code: 'Pizza',
                display: 'Delicious pizza to share.'
              }
            ]
          },
          {
            system: 'http://food.org/food',
            version: '2.0.1',
            concept: [
              {
                code: 'Salad',
                display: 'Plenty of fresh vegetables.',
                designation: [
                  {
                    value: 'Salat'
                  }
                ]
              }
            ]
          }
        ]
      }
    });
    expect(designationValue.isCodeCaretRule).toBeTrue();
    expect(loggerSpy.getAllMessages('error')).toHaveLength(0);
  });

  describe('#insertRules', () => {
    let vs: FshValueSet;
    let ruleSet: RuleSet;

    beforeEach(() => {
      vs = new FshValueSet('Foo');
      doc.valueSets.set(vs.name, vs);

      ruleSet = new RuleSet('Bar');
      doc.ruleSets.set(ruleSet.name, ruleSet);
    });

    it('should apply rules from an insert rule', () => {
      // RuleSet: Bar
      // * ^title = "Wow fancy"
      //
      // ValueSet: Foo
      // * insert Bar
      const nameRule = new CaretValueRule('');
      nameRule.caretPath = 'title';
      nameRule.value = 'Wow fancy';
      ruleSet.rules.push(nameRule);

      const insertRule = new InsertRule('');
      insertRule.ruleSet = 'Bar';
      vs.rules.push(insertRule);

      exporter.applyInsertRules();
      const exported = exporter.exportValueSet(vs);
      expect(exported.title).toBe('Wow fancy');
    });

    it('should apply a CaretValueRule from a rule set with soft indexing', () => {
      const caretRule1 = new CaretValueRule('');
      caretRule1.caretPath = 'contact[+].name';
      caretRule1.value = 'Johnny Appleseed';
      ruleSet.rules.push(caretRule1);
      const caretRule2 = new CaretValueRule('');
      caretRule2.caretPath = 'contact[=].telecom[+].rank';
      caretRule2.value = 1;
      ruleSet.rules.push(caretRule2);
      const caretRule3 = new CaretValueRule('');
      caretRule3.caretPath = 'contact[=].telecom[=].value';
      caretRule3.value = 'email.email@email.com';
      ruleSet.rules.push(caretRule3);

      const insertRule = new InsertRule('');
      insertRule.ruleSet = 'Bar';
      vs.rules.push(insertRule);

      exporter.applyInsertRules();
      const exported = exporter.exportValueSet(vs);
      expect(exported.contact).toEqual([
        {
          name: 'Johnny Appleseed',
          telecom: [
            {
              rank: 1,
              value: 'email.email@email.com'
            }
          ]
        }
      ]);
    });

    it('should apply concept-creating rules from a rule set and combine concepts from the same system', () => {
      // RuleSet: Bar
      // * http://food.org/food#bread "bread"
      // * #granola from system http://food.org/food
      // * http://food.org/food#toast "toast"
      //
      // ValueSet: Foo
      // * insert Bar

      // due to rule precedence, a RuleSet will sometimes create a ConceptRule,
      // even when the eventual use is a VsConceptComponentRule.
      // that's fine, though. we can handle that.
      const breadRule = new ConceptRule('bread', 'bread');
      breadRule.system = 'http://food.org/food';
      const granolaRule = new ValueSetConceptComponentRule(true);
      granolaRule.from.system = 'http://food.org/food';
      granolaRule.concepts.push(new FshCode('granola', 'http://food.org/food'));
      const toastRule = new ConceptRule('toast', 'toast');
      toastRule.system = 'http://food.org/food';
      ruleSet.rules.push(breadRule, granolaRule, toastRule);

      const breakfastInsert = new InsertRule('');
      breakfastInsert.ruleSet = 'Bar';
      vs.rules.push(breakfastInsert);

      exporter.applyInsertRules();
      const exported = exporter.exportValueSet(vs);
      const inclusions = exported.compose.include;
      expect(inclusions).toHaveLength(1);
      expect(inclusions[0]).toEqual({
        system: 'http://food.org/food',
        concept: [
          {
            code: 'bread',
            display: 'bread'
          },
          {
            code: 'granola'
          },
          {
            code: 'toast',
            display: 'toast'
          }
        ]
      });
      expect(loggerSpy.getAllMessages('error')).toHaveLength(0);
    });

    it('should apply concept-creating rules from a rule set and combine concepts from the same system and valuesets', () => {
      // RuleSet: Bar
      // * http://food.org/food#bread from valueset http://food.org/BakeryVS
      // * #granola from system http://food.org/food and valueset http://food.org/CerealVS
      // * http://food.org/food#toast from valueset http://food.org/BakeryVS
      // * #oatmeal from system http://food.org/food and valueset http://food.org/CerealVS and http://food.org/BakeryVS
      // * #porridge from system http://food.org/food and valueset http://food.org/BakeryVS and http://food.org/CerealVS
      //
      // ValueSet: Foo
      // * insert Bar
      const breadRule = new ValueSetConceptComponentRule(true);
      breadRule.from = {
        system: 'http://food.org/food',
        valueSets: ['http://food.org/BakeryVS']
      };
      breadRule.concepts.push(new FshCode('bread', 'http://food.org/food'));
      const granolaRule = new ValueSetConceptComponentRule(true);
      granolaRule.from = {
        system: 'http://food.org/food',
        valueSets: ['http://food.org/CerealVS']
      };
      granolaRule.concepts.push(new FshCode('granola', 'http://food.org/food'));
      const toastRule = new ValueSetConceptComponentRule(true);
      toastRule.from = {
        system: 'http://food.org/food',
        valueSets: ['http://food.org/BakeryVS']
      };
      toastRule.concepts.push(new FshCode('toast', 'http://food.org/food'));
      const oatmealRule = new ValueSetConceptComponentRule(true);
      oatmealRule.from = {
        system: 'http://food.org/food',
        valueSets: ['http://food.org/CerealVS', 'http://food.org/BakeryVS']
      };
      oatmealRule.concepts.push(new FshCode('oatmeal', 'http://food.org/food'));
      const porridgeRule = new ValueSetConceptComponentRule(true);
      porridgeRule.from = {
        system: 'http://food.org/food',
        valueSets: ['http://food.org/BakeryVS', 'http://food.org/CerealVS']
      };
      porridgeRule.concepts.push(new FshCode('porridge', 'http://food.org/food'));
      ruleSet.rules.push(breadRule, granolaRule, toastRule, oatmealRule, porridgeRule);

      const breakfastInsert = new InsertRule('');
      breakfastInsert.ruleSet = 'Bar';
      vs.rules.push(breakfastInsert);

      exporter.applyInsertRules();
      const exported = exporter.exportValueSet(vs);
      const inclusions = exported.compose.include;
      expect(inclusions).toHaveLength(3);
      expect(inclusions[0]).toEqual({
        system: 'http://food.org/food',
        valueSet: ['http://food.org/BakeryVS'],
        concept: [{ code: 'bread' }, { code: 'toast' }]
      });
      expect(inclusions[1]).toEqual({
        system: 'http://food.org/food',
        valueSet: ['http://food.org/CerealVS'],
        concept: [{ code: 'granola' }]
      });
      expect(inclusions[2]).toEqual({
        system: 'http://food.org/food',
        valueSet: ['http://food.org/CerealVS', 'http://food.org/BakeryVS'],
        concept: [{ code: 'oatmeal' }, { code: 'porridge' }]
      });
      expect(loggerSpy.getAllMessages('error')).toHaveLength(0);
    });

    it('should apply concept-creating rules from a rule set and combine excluded concepts from the same system and valuesets', () => {
      // RuleSet: Bar
      // * http://food.org/food#bread from valueset http://food.org/BakeryVS
      // * #granola from system http://food.org/food and valueset http://food.org/CerealVS
      // * http://food.org/food#toast from valueset http://food.org/BakeryVS
      // * exclude #oatmeal from system http://food.org/food and valueset http://food.org/CerealVS and http://food.org/BakeryVS
      // * exclude #porridge from system http://food.org/food and valueset http://food.org/BakeryVS and http://food.org/CerealVS
      //
      // ValueSet: Foo
      // * insert Bar
      const breadRule = new ValueSetConceptComponentRule(true);
      breadRule.from = {
        system: 'http://food.org/food',
        valueSets: ['http://food.org/BakeryVS']
      };
      breadRule.concepts.push(new FshCode('bread', 'http://food.org/food'));
      const granolaRule = new ValueSetConceptComponentRule(true);
      granolaRule.from = {
        system: 'http://food.org/food',
        valueSets: ['http://food.org/CerealVS']
      };
      granolaRule.concepts.push(new FshCode('granola', 'http://food.org/food'));
      const toastRule = new ValueSetConceptComponentRule(true);
      toastRule.from = {
        system: 'http://food.org/food',
        valueSets: ['http://food.org/BakeryVS']
      };
      toastRule.concepts.push(new FshCode('toast', 'http://food.org/food'));
      const oatmealRule = new ValueSetConceptComponentRule(false);
      oatmealRule.from = {
        system: 'http://food.org/food',
        valueSets: ['http://food.org/CerealVS', 'http://food.org/BakeryVS']
      };
      oatmealRule.concepts.push(new FshCode('oatmeal', 'http://food.org/food'));
      const porridgeRule = new ValueSetConceptComponentRule(false);
      porridgeRule.from = {
        system: 'http://food.org/food',
        valueSets: ['http://food.org/BakeryVS', 'http://food.org/CerealVS']
      };
      porridgeRule.concepts.push(new FshCode('porridge', 'http://food.org/food'));
      ruleSet.rules.push(breadRule, granolaRule, toastRule, oatmealRule, porridgeRule);

      const breakfastInsert = new InsertRule('');
      breakfastInsert.ruleSet = 'Bar';
      vs.rules.push(breakfastInsert);

      exporter.applyInsertRules();
      const exported = exporter.exportValueSet(vs);
      const inclusions = exported.compose.include;
      expect(inclusions).toHaveLength(2);
      expect(inclusions[0]).toEqual({
        system: 'http://food.org/food',
        valueSet: ['http://food.org/BakeryVS'],
        concept: [{ code: 'bread' }, { code: 'toast' }]
      });
      expect(inclusions[1]).toEqual({
        system: 'http://food.org/food',
        valueSet: ['http://food.org/CerealVS'],
        concept: [{ code: 'granola' }]
      });
      const exclusions = exported.compose.exclude;
      expect(exclusions).toHaveLength(1);
      expect(exclusions[0]).toEqual({
        system: 'http://food.org/food',
        valueSet: ['http://food.org/CerealVS', 'http://food.org/BakeryVS'],
        concept: [{ code: 'oatmeal' }, { code: 'porridge' }]
      });
    });

    it('should log an error and not apply rules from an invalid insert rule', () => {
      // RuleSet: Bar
      // * experimental = true
      // * ^title = "Wow fancy"
      //
      // ValueSet: Foo
      // * insert Bar
      const valueRule = new AssignmentRule('experimental')
        .withFile('Value.fsh')
        .withLocation([1, 2, 3, 4]);
      valueRule.value = true;
      const nameRule = new CaretValueRule('');
      nameRule.caretPath = 'title';
      nameRule.value = 'Wow fancy';
      ruleSet.rules.push(valueRule, nameRule);

      const insertRule = new InsertRule('').withFile('Insert.fsh').withLocation([5, 6, 7, 8]);
      insertRule.ruleSet = 'Bar';
      vs.rules.push(insertRule);

      exporter.applyInsertRules();
      const exported = exporter.exportValueSet(vs);
      // CaretRule is still applied
      expect(exported.title).toBe('Wow fancy');
      // experimental is not set to true
      expect(exported.experimental).toBeFalsy();
      expect(loggerSpy.getLastMessage('error')).toMatch(
        /AssignmentRule.*FshValueSet.*File: Value\.fsh.*Line: 1 - 3.*Applied in File: Insert\.fsh.*Applied on Line: 5 - 7/s
      );
    });
  });
});
