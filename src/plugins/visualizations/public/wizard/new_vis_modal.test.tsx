/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * The OpenSearch Contributors require contributions made to
 * this file be licensed under the Apache-2.0 license or a
 * compatible open source license.
 *
 * Any modifications Copyright OpenSearch Contributors. See
 * GitHub history for details.
 */

/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import React from 'react';
import { mountWithIntl } from 'test_utils/enzyme_helpers';
import { TypesStart, VisType } from '../vis_types';
import { NewVisModal } from './new_vis_modal';
import { ApplicationStart, SavedObjectsStart } from '../../../../core/public';
import { embeddablePluginMock } from '../../../embeddable/public/mocks';

describe('NewVisModal', () => {
  const defaultVisTypeParams = {
    hidden: false,
    visualization: class Controller {
      public render = jest.fn();
      public destroy = jest.fn();
    },
    requiresSearch: false,
    requestHandler: 'none',
    responseHandler: 'none',
  };
  const _visTypes = [
    { name: 'vis', title: 'Vis Type 1', stage: 'production', ...defaultVisTypeParams },
    { name: 'visExp', title: 'Experimental Vis', stage: 'experimental', ...defaultVisTypeParams },
    {
      name: 'visWithSearch',
      title: 'Vis with search',
      stage: 'production',
      ...defaultVisTypeParams,
    },
    {
      name: 'visWithAliasUrl',
      title: 'Vis with alias Url',
      stage: 'production',
      aliasApp: 'otherApp',
      aliasPath: '#/aliasUrl',
    },
    {
      name: 'visAliasWithPromotion',
      title: 'Vis alias with promotion',
      stage: 'production',
      aliasApp: 'anotherApp',
      aliasPath: '#/anotherUrl',
      promotion: {
        description: 'promotion description',
        buttonText: 'another app',
      },
    },
  ];
  const visTypes: TypesStart = {
    get<T>(id: string): VisType<T> {
      return (_visTypes.find((vis) => vis.name === id) as unknown) as VisType<T>;
    },
    all: () => {
      return (_visTypes as unknown) as VisType[];
    },
    getAliases: () => [],
  };
  const addBasePath = (url: string) => `testbasepath${url}`;
  const settingsGet = jest.fn();
  const uiSettings: any = { get: settingsGet };

  beforeAll(() => {
    Object.defineProperty(window, 'location', {
      value: {
        assign: jest.fn(),
      },
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render as expected', () => {
    const wrapper = mountWithIntl(
      // @ts-expect-error TS2741 TODO(ts-error): fixme
      <NewVisModal
        isOpen={true}
        onClose={() => null}
        visTypesRegistry={visTypes}
        addBasePath={addBasePath}
        uiSettings={uiSettings}
        application={{} as ApplicationStart}
        savedObjects={{} as SavedObjectsStart}
      />
    );
    expect(wrapper).toMatchSnapshot();
  });

  it('should show a button for regular visualizations', () => {
    const wrapper = mountWithIntl(
      // @ts-expect-error TS2741 TODO(ts-error): fixme
      <NewVisModal
        isOpen={true}
        onClose={() => null}
        visTypesRegistry={visTypes}
        addBasePath={addBasePath}
        uiSettings={uiSettings}
        application={{} as ApplicationStart}
        savedObjects={{} as SavedObjectsStart}
      />
    );
    expect(wrapper.find('[data-test-subj="visType-vis"]').exists()).toBe(true);
  });

  it('should sort promoted visualizations first', () => {
    const wrapper = mountWithIntl(
      // @ts-expect-error TS2741 TODO(ts-error): fixme
      <NewVisModal
        isOpen={true}
        onClose={() => null}
        visTypesRegistry={visTypes}
        addBasePath={addBasePath}
        uiSettings={uiSettings}
        application={{} as ApplicationStart}
        savedObjects={{} as SavedObjectsStart}
      />
    );
    expect(
      wrapper
        .find('button[data-test-subj^="visType-"]')
        .map((button) => button.prop('data-test-subj'))
    ).toEqual([
      'visType-visAliasWithPromotion',
      'visType-vis',
      'visType-visWithAliasUrl',
      'visType-visWithSearch',
    ]);
  });

  describe('open editor', () => {
    it('should open the editor for visualizations without search', () => {
      const wrapper = mountWithIntl(
        // @ts-expect-error TS2741 TODO(ts-error): fixme
        <NewVisModal
          isOpen={true}
          onClose={() => null}
          visTypesRegistry={visTypes}
          addBasePath={addBasePath}
          uiSettings={uiSettings}
          application={{} as ApplicationStart}
          savedObjects={{} as SavedObjectsStart}
        />
      );
      const visButton = wrapper.find('button[data-test-subj="visType-vis"]');
      visButton.simulate('click');
      expect(window.location.assign).toBeCalledWith('testbasepath/app/visualize#/create?type=vis');
    });

    it('passes through editor params to the editor URL', () => {
      const wrapper = mountWithIntl(
        // @ts-expect-error TS2741 TODO(ts-error): fixme
        <NewVisModal
          isOpen={true}
          onClose={() => null}
          visTypesRegistry={visTypes}
          editorParams={['foo=true', 'bar=42']}
          addBasePath={addBasePath}
          uiSettings={uiSettings}
          application={{} as ApplicationStart}
          savedObjects={{} as SavedObjectsStart}
        />
      );
      const visButton = wrapper.find('button[data-test-subj="visType-vis"]');
      visButton.simulate('click');
      expect(window.location.assign).toBeCalledWith(
        'testbasepath/app/visualize#/create?type=vis&foo=true&bar=42'
      );
    });

    it('closes and redirects properly if visualization with aliasPath and originatingApp in props', () => {
      const onClose = jest.fn();
      const navigateToApp = jest.fn();
      const stateTransfer = embeddablePluginMock.createStartContract().getStateTransfer();
      const wrapper = mountWithIntl(
        // @ts-expect-error TS2741 TODO(ts-error): fixme
        <NewVisModal
          isOpen={true}
          onClose={onClose}
          visTypesRegistry={visTypes}
          editorParams={['foo=true', 'bar=42']}
          originatingApp={'coolJestTestApp'}
          addBasePath={addBasePath}
          uiSettings={uiSettings}
          application={({ navigateToApp } as unknown) as ApplicationStart}
          stateTransfer={stateTransfer}
          savedObjects={{} as SavedObjectsStart}
        />
      );
      const visButton = wrapper.find('button[data-test-subj="visType-visWithAliasUrl"]');
      visButton.simulate('click');
      expect(stateTransfer.navigateToEditor).toBeCalledWith('otherApp', {
        path: '#/aliasUrl',
        state: { originatingApp: 'coolJestTestApp' },
      });
      expect(onClose).toHaveBeenCalled();
    });

    it('closes and redirects properly if visualization with aliasApp and without originatingApp in props', () => {
      const onClose = jest.fn();
      const navigateToApp = jest.fn();
      const wrapper = mountWithIntl(
        // @ts-expect-error TS2741 TODO(ts-error): fixme
        <NewVisModal
          isOpen={true}
          onClose={onClose}
          visTypesRegistry={visTypes}
          editorParams={['foo=true', 'bar=42']}
          addBasePath={addBasePath}
          uiSettings={uiSettings}
          application={({ navigateToApp } as unknown) as ApplicationStart}
          savedObjects={{} as SavedObjectsStart}
        />
      );
      const visButton = wrapper.find('button[data-test-subj="visType-visWithAliasUrl"]');
      visButton.simulate('click');
      expect(navigateToApp).toBeCalledWith('otherApp', { path: '#/aliasUrl' });
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('filter for visualization types', () => {
    it('should render as expected', () => {
      const wrapper = mountWithIntl(
        // @ts-expect-error TS2741 TODO(ts-error): fixme
        <NewVisModal
          isOpen={true}
          onClose={() => null}
          visTypesRegistry={visTypes}
          addBasePath={addBasePath}
          uiSettings={uiSettings}
          application={{} as ApplicationStart}
          savedObjects={{} as SavedObjectsStart}
        />
      );
      const searchBox = wrapper.find('input[data-test-subj="filterVisType"]');
      searchBox.simulate('change', { target: { value: 'with' } });
      expect(wrapper).toMatchSnapshot();
    });
  });

  describe('experimental visualizations', () => {
    it('should not show experimental visualizations if visualize:enableLabs is false', () => {
      settingsGet.mockReturnValue(false);
      const wrapper = mountWithIntl(
        // @ts-expect-error TS2741 TODO(ts-error): fixme
        <NewVisModal
          isOpen={true}
          onClose={() => null}
          visTypesRegistry={visTypes}
          addBasePath={addBasePath}
          uiSettings={uiSettings}
          application={{} as ApplicationStart}
          savedObjects={{} as SavedObjectsStart}
        />
      );
      expect(wrapper.find('[data-test-subj="visType-visExp"]').exists()).toBe(false);
    });

    it('should show experimental visualizations if visualize:enableLabs is true', () => {
      settingsGet.mockReturnValue(true);
      const wrapper = mountWithIntl(
        // @ts-expect-error TS2741 TODO(ts-error): fixme
        <NewVisModal
          isOpen={true}
          onClose={() => null}
          visTypesRegistry={visTypes}
          addBasePath={addBasePath}
          uiSettings={uiSettings}
          application={{} as ApplicationStart}
          savedObjects={{} as SavedObjectsStart}
        />
      );
      expect(wrapper.find('[data-test-subj="visType-visExp"]').exists()).toBe(true);
    });
  });
});
