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

import {
  EuiButtonGroup,
  EuiCompressedFieldSearch,
  EuiCompressedSwitch,
  EuiFilterGroup,
  EuiFlexGroup,
  EuiFlexItem,
  EuiForm,
  EuiFormRow,
  EuiOutsideClickDetector,
  EuiPanel,
  EuiPopover,
  EuiPopoverFooter,
  EuiPopoverTitle,
  EuiSelect,
  EuiSmallFilterButton,
  EuiSwitchEvent,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { FormattedMessage } from '@osd/i18n/react';
import React, { OptionHTMLAttributes, ReactNode, useState } from 'react';

export const NUM_FILTERS = 3;

export interface State {
  searchable: string;
  aggregatable: string;
  type: string;
  missing: boolean;
  [index: string]: string | boolean;
}

export interface Props {
  /**
   * triggered on input of user into search field
   */
  onChange: (field: string, value: string | boolean | undefined) => void;

  /**
   * the input value of the user
   */
  value?: string;

  /**
   * types for the type filter
   */
  types: string[];
  isEnhancementsEnabledOverride: boolean;
}

/**
 * Component is Discover's side bar to  search of available fields
 * Additionally there's a button displayed that allows the user to show/hide more filter fields
 */
export function DiscoverFieldSearch({
  onChange,
  value,
  types,
  isEnhancementsEnabledOverride,
}: Props) {
  const searchPlaceholder = i18n.translate('explore.discover.fieldChooser.searchPlaceHolder', {
    defaultMessage: 'Search field names',
  });
  const aggregatableLabel = i18n.translate(
    'explore.discover.fieldChooser.filter.aggregatableLabel',
    {
      defaultMessage: 'Aggregatable',
    }
  );
  const searchableLabel = i18n.translate('explore.discover.fieldChooser.filter.searchableLabel', {
    defaultMessage: 'Searchable',
  });
  const typeLabel = i18n.translate('explore.discover.fieldChooser.filter.typeLabel', {
    defaultMessage: 'Type',
  });
  const typeOptions = types
    ? types.map((type) => {
        return { value: type, text: type };
      })
    : [{ value: 'any', text: 'any' }];

  const [activeFiltersCount, setActiveFiltersCount] = useState(0);
  const [isPopoverOpen, setPopoverOpen] = useState(false);
  const [values, setValues] = useState<State>({
    searchable: 'any',
    aggregatable: 'any',
    type: 'any',
    missing: false,
  });

  const filterBtnAriaLabel = isPopoverOpen
    ? i18n.translate('explore.discover.fieldChooser.toggleFieldFilterButtonHideAriaLabel', {
        defaultMessage: 'Hide field filter settings',
      })
    : i18n.translate('explore.discover.fieldChooser.toggleFieldFilterButtonShowAriaLabel', {
        defaultMessage: 'Show field filter settings',
      });

  const handleFacetButtonClicked = () => {
    setPopoverOpen(!isPopoverOpen);
  };

  const applyFilterValue = (id: string, filterValue: string | boolean) => {
    switch (filterValue) {
      case 'any':
        if (id !== 'type') {
          onChange(id, undefined);
        } else {
          onChange(id, filterValue);
        }
        break;
      case 'true':
        onChange(id, true);
        break;
      case 'false':
        onChange(id, false);
        break;
      default:
        onChange(id, filterValue);
    }
  };

  const isFilterActive = (name: string, filterValue: string | boolean) => {
    return name !== 'missing' && filterValue !== 'any';
  };

  const handleValueChange = (name: string, filterValue: string | boolean) => {
    const previousValue = values[name];
    updateFilterCount(name, previousValue, filterValue);
    const updatedValues = { ...values };
    updatedValues[name] = filterValue;
    setValues(updatedValues);
    applyFilterValue(name, filterValue);
  };

  const updateFilterCount = (
    name: string,
    previousValue: string | boolean,
    currentValue: string | boolean
  ) => {
    const previouslyFilterActive = isFilterActive(name, previousValue);
    const filterActive = isFilterActive(name, currentValue);
    const diff = Number(filterActive) - Number(previouslyFilterActive);
    setActiveFiltersCount(activeFiltersCount + diff);
  };

  const handleMissingChange = (e: EuiSwitchEvent) => {
    const missingValue = e.target.checked;
    handleValueChange('missing', missingValue);
  };

  const select = (
    id: string,
    selectOptions: Array<{ text: ReactNode } & OptionHTMLAttributes<HTMLOptionElement>>,
    selectValue: string
  ) => {
    return (
      <EuiSelect
        id={`${id}-select`}
        options={selectOptions}
        value={selectValue}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
          handleValueChange(id, e.target.value)
        }
        aria-label={i18n.translate('explore.discover.fieldChooser.filter.fieldSelectorLabel', {
          defaultMessage: 'Selection of {id} filter options',
          values: { id },
        })}
        data-test-subj={`${id}Select`}
        compressed
      />
    );
  };

  const toggleButtons = (id: string) => {
    return [
      {
        id: `${id}-any`,
        label: 'any',
      },
      {
        id: `${id}-true`,
        label: 'yes',
      },
      {
        id: `${id}-false`,
        label: 'no',
      },
    ];
  };

  const buttonGroup = (id: string, legend: string) => {
    return (
      <EuiButtonGroup
        legend={legend}
        options={toggleButtons(id)}
        idSelected={`${id}-${values[id]}`}
        onChange={(optionId: string) => handleValueChange(id, optionId.replace(`${id}-`, ''))}
        buttonSize="compressed"
        isFullWidth
        data-test-subj={`${id}ButtonGroup`}
      />
    );
  };

  const selectionPanel = (
    <EuiPanel hasBorder={false} hasShadow={false} paddingSize="s">
      <EuiForm data-test-subj="filterSelectionPanel">
        <EuiFormRow fullWidth label={aggregatableLabel} display="columnCompressed">
          {buttonGroup('aggregatable', aggregatableLabel)}
        </EuiFormRow>
        <EuiFormRow fullWidth label={searchableLabel} display="columnCompressed">
          {buttonGroup('searchable', searchableLabel)}
        </EuiFormRow>
        <EuiFormRow fullWidth label={typeLabel} display="columnCompressed">
          {select('type', typeOptions, values.type)}
        </EuiFormRow>
      </EuiForm>
    </EuiPanel>
  );

  const compressedFieldSearch = (
    <EuiOutsideClickDetector onOutsideClick={() => {}} isDisabled={!isPopoverOpen}>
      <EuiCompressedFieldSearch
        aria-label={searchPlaceholder}
        data-test-subj="fieldFilterSearchInput"
        fullWidth
        onChange={(event) => onChange('name', event.currentTarget.value)}
        placeholder={searchPlaceholder}
        value={value}
        className="exploreSideBar_searchInput"
      />
    </EuiOutsideClickDetector>
  );

  const fieldPopover = (
    <EuiPopover
      id="dataPanelTypeFilter"
      panelClassName="euiFilterGroup__popoverPanel dataPanelTypeFilterPopover"
      panelPaddingSize="none"
      anchorPosition="downLeft"
      display="block"
      isOpen={isPopoverOpen}
      closePopover={() => {
        setPopoverOpen(false);
      }}
      button={
        <EuiSmallFilterButton
          iconType="filter"
          iconSide="left"
          iconGap="none"
          hasActiveFilters={activeFiltersCount > 0}
          aria-label={filterBtnAriaLabel}
          data-test-subj="toggleFieldFilterButton"
          numFilters={activeFiltersCount} // {NUM_FILTERS} https://github.com/opensearch-project/oui/issues/1219
          onClick={handleFacetButtonClicked}
          numActiveFilters={activeFiltersCount}
          isSelected={isPopoverOpen}
          className={isEnhancementsEnabledOverride ? 'toggleFieldFilterButton' : ''}
        >
          {!isEnhancementsEnabledOverride && (
            <FormattedMessage
              id="explore.discover.fieldChooser.fieldFilterFacetButtonLabel"
              defaultMessage="Filter by type"
            />
          )}
        </EuiSmallFilterButton>
      }
    >
      <EuiPopoverTitle>
        {i18n.translate('explore.discover.fieldChooser.filter.filterByTypeLabel', {
          defaultMessage: 'Filter by type',
        })}
      </EuiPopoverTitle>
      {selectionPanel}
      <EuiPopoverFooter>
        <EuiCompressedSwitch
          label={i18n.translate('explore.discover.fieldChooser.filter.hideMissingFieldsLabel', {
            defaultMessage: 'Hide missing fields',
          })}
          checked={values.missing}
          onChange={handleMissingChange}
          data-test-subj="missingSwitch"
        />
      </EuiPopoverFooter>
    </EuiPopover>
  );

  if (isEnhancementsEnabledOverride) {
    return (
      <div
        className="euiFormControlLayout euiFormControlLayout--compressed euiFormControlLayout--group osdDiscoverSideBar__wrap"
        data-test-subj="osdDiscoverSideBarWrapper"
      >
        {compressedFieldSearch}
        {fieldPopover}
      </div>
    );
  } else {
    return (
      <EuiFlexGroup responsive={false} gutterSize="xs">
        <EuiFlexItem>{compressedFieldSearch}</EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiFilterGroup>{fieldPopover}</EuiFilterGroup>
        </EuiFlexItem>
      </EuiFlexGroup>
    );
  }
}
