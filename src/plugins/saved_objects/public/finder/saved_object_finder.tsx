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

import _ from 'lodash';
import PropTypes from 'prop-types';
import React from 'react';

import {
  EuiContextMenuItem,
  EuiContextMenuPanel,
  EuiEmptyPrompt,
  EuiCompressedFieldSearch,
  EuiSmallFilterButton,
  EuiFilterGroup,
  EuiFlexGroup,
  EuiFlexItem,
  EuiListGroup,
  EuiListGroupItem,
  EuiLoadingSpinner,
  EuiPagination,
  EuiPopover,
  EuiSpacer,
  EuiTablePagination,
  IconType,
} from '@elastic/eui';
import { Direction } from '@elastic/eui/src/services/sort/sort_direction';
import { i18n } from '@osd/i18n';

import {
  SimpleSavedObject,
  CoreStart,
  IUiSettingsClient,
  SavedObjectsStart,
  ApplicationStart,
} from 'src/core/public';

import { DataSourceAttributes } from 'src/plugins/data_source/common/data_sources';
import { DataPublicPluginStart, LanguageServiceContract } from 'src/plugins/data/public';
import { first } from 'rxjs/operators';
import { getIndexPatternTitle } from '../../../data/common/index_patterns/utils';
import { LISTING_LIMIT_SETTING } from '../../common';

export interface SavedObjectMetaData<T = unknown> {
  type: string;
  name: string;
  getIconForSavedObject(savedObject: SimpleSavedObject<T>): IconType;
  getTooltipForSavedObject?(savedObject: SimpleSavedObject<T>): string;
  showSavedObject?(savedObject: SimpleSavedObject<T>): boolean;
  includeFields?: string[];
}

interface FinderAttributes {
  title?: string;
  type: string;
  kibanaSavedObjectMeta?: string;
}

interface SavedObjectFinderState {
  items: Array<{
    title: string | null;
    id: SimpleSavedObject['id'];
    type: SimpleSavedObject['type'];
    savedObject: SimpleSavedObject<FinderAttributes>;
  }>;
  query: string;
  isFetchingItems: boolean;
  page: number;
  perPage: number;
  sortDirection?: Direction;
  sortOpen: boolean;
  filterOpen: boolean;
  filteredTypes: string[];
}

interface BaseSavedObjectFinder {
  onChoose?: (
    id: SimpleSavedObject['id'],
    type: SimpleSavedObject['type'],
    name: string,
    savedObject: SimpleSavedObject<FinderAttributes>
  ) => void;
  noItemsMessage?: React.ReactNode;
  savedObjectMetaData: Array<SavedObjectMetaData<FinderAttributes>>;
  showFilter?: boolean;
}

interface SavedObjectFinderFixedPage extends BaseSavedObjectFinder {
  initialPageSize?: undefined;
  fixedPageSize: number;
}

interface SavedObjectFinderInitialPageSize extends BaseSavedObjectFinder {
  initialPageSize?: 5 | 10 | 15 | 25;
  fixedPageSize?: undefined;
}

export type SavedObjectFinderProps = SavedObjectFinderFixedPage | SavedObjectFinderInitialPageSize;

export type SavedObjectFinderUiProps = {
  savedObjects: CoreStart['savedObjects'];
  uiSettings: CoreStart['uiSettings'];
  data?: DataPublicPluginStart;
  application?: CoreStart['application'];
} & SavedObjectFinderProps;

class SavedObjectFinderUi extends React.Component<
  SavedObjectFinderUiProps,
  SavedObjectFinderState
> {
  public static propTypes = {
    onChoose: PropTypes.func,
    noItemsMessage: PropTypes.node,
    savedObjectMetaData: PropTypes.array.isRequired,
    initialPageSize: PropTypes.oneOf([5, 10, 15, 25]),
    fixedPageSize: PropTypes.number,
    showFilter: PropTypes.bool,
  };

  public async getCurrentAppId() {
    return (
      (await this.props?.application?.currentAppId$?.pipe(first()).toPromise()) ??
      Promise.resolve(undefined)
    );
  }

  readonly languageService = this.props.data?.query?.queryString?.getLanguageService();
  private isComponentMounted: boolean = false;

  private isSavedSearchLanguageSupported(
    languageId?: string,
    currentAppId?: string,
    languageService?: LanguageServiceContract
  ) {
    if (!languageId || !currentAppId || !languageService) {
      return true;
    }
    const supportedInApp = languageService
      ?.getLanguage(languageId)
      ?.supportedAppNames?.includes(currentAppId);
    // If the current app id is explore, although explore app might not support
    // a language, it still supports all saved searches that are supported by
    // discover by redirecting to discover for backward compatibility.
    if (currentAppId.includes('explore/')) {
      return (
        (supportedInApp ||
          languageService?.getLanguage(languageId)?.supportedAppNames?.includes('discover')) ??
        true
      );
    }
    return supportedInApp ?? true;
  }

  private debouncedFetch = _.debounce(async (query: string) => {
    const metaDataMap = this.getSavedObjectMetaDataMap();

    const fields = Object.values(metaDataMap)
      .map((metaData) => metaData.includeFields || [])
      .reduce((allFields, currentFields) => allFields.concat(currentFields), ['title']);

    const perPage = this.props.uiSettings.get(LISTING_LIMIT_SETTING);
    const resp = await this.props.savedObjects.client.find<FinderAttributes>({
      type: Object.keys(metaDataMap),
      fields: [...new Set(fields)],
      search: query ? `${query}*` : undefined,
      page: 1,
      perPage,
      searchFields: ['title^3', 'description'],
      defaultSearchOperator: 'AND',
    });

    const getDataSource = async (id: string) => {
      const client = this.props.savedObjects.client;
      return await client.get<DataSourceAttributes>('data-source', id);
    };

    const currentAppId = await this.getCurrentAppId();

    const savedObjects = await Promise.all(
      resp.savedObjects.map(async (obj) => {
        if (obj.type === 'index-pattern') {
          const result = { ...obj };
          result.attributes.title = await getIndexPatternTitle(
            obj.attributes.title!,
            obj.references,
            getDataSource
          );
          return result;
        } else if (obj.type === 'search') {
          const sourceObject = JSON.parse(
            // @ts-expect-error TS2339 TODO(ts-error): fixme
            obj.attributes?.kibanaSavedObjectMeta?.searchSourceJSON ?? null
          );
          const languageId = sourceObject?.query?.language;
          if (this.isSavedSearchLanguageSupported(languageId, currentAppId, this.languageService)) {
            return obj;
          }
        } else {
          return obj;
        }
      })
    );

    // @ts-expect-error TS2322 TODO(ts-error): fixme
    resp.savedObjects = savedObjects.filter((savedObject) => {
      if (!savedObject) {
        return false;
      }
      const metaData = metaDataMap[savedObject.type];
      if (metaData.showSavedObject) {
        // @ts-expect-error TS2345 TODO(ts-error): fixme
        return metaData.showSavedObject(savedObject);
      } else {
        return true;
      }
    });

    if (!this.isComponentMounted) {
      return;
    }

    // We need this check to handle the case where search results come back in a different
    // order than they were sent out. Only load results for the most recent search.
    if (query === this.state.query) {
      this.setState({
        isFetchingItems: false,
        page: 0,
        items: resp.savedObjects.map((savedObject) => {
          const {
            attributes: { title },
            id,
            type,
          } = savedObject;

          return {
            title: typeof title === 'string' ? title : '',
            id,
            type,
            savedObject,
          };
        }),
      });
    }
  }, 300);

  constructor(props: SavedObjectFinderUiProps) {
    super(props);

    this.state = {
      items: [],
      isFetchingItems: false,
      page: 0,
      perPage: props.initialPageSize || props.fixedPageSize || 10,
      query: '',
      filterOpen: false,
      filteredTypes: [],
      sortOpen: false,
    };
  }

  public componentWillUnmount() {
    this.isComponentMounted = false;
    this.debouncedFetch.cancel();
  }

  public componentDidMount() {
    this.isComponentMounted = true;
    this.fetchItems();
  }

  public render() {
    return (
      <React.Fragment>
        {this.renderSearchBar()}
        {this.renderListing()}
      </React.Fragment>
    );
  }

  private getSavedObjectMetaDataMap(): Record<string, SavedObjectMetaData> {
    return this.props.savedObjectMetaData.reduce(
      (map, metaData) => ({ ...map, [metaData.type]: metaData }),
      {}
    );
  }

  private getPageCount() {
    return Math.ceil(
      (this.state.filteredTypes.length === 0
        ? this.state.items.length
        : this.state.items.filter(
            (item) =>
              this.state.filteredTypes.length === 0 || this.state.filteredTypes.includes(item.type)
          ).length) / this.state.perPage
    );
  }

  // server-side paging not supported
  // 1) saved object client does not support sorting by title because title is only mapped as analyzed
  // 2) can not search on anything other than title because all other fields are stored in opaque JSON strings,
  //    for example, visualizations need to be search by isLab but this is not possible in OpenSearch side
  //    with the current mappings
  private getPageOfItems = () => {
    // do not sort original list to preserve opensearch ranking order
    const items = this.state.items.slice();
    const { sortDirection } = this.state;

    if (sortDirection || !this.state.query) {
      items.sort(({ title: titleA }, { title: titleB }) => {
        let order = 1;
        if (sortDirection === 'desc') {
          order = -1;
        }
        return order * (titleA || '').toLowerCase().localeCompare((titleB || '').toLowerCase());
      });
    }

    // If begin is greater than the length of the sequence, an empty array is returned.
    const startIndex = this.state.page * this.state.perPage;
    // If end is greater than the length of the sequence, slice extracts through to the end of the sequence (arr.length).
    const lastIndex = startIndex + this.state.perPage;
    return items
      .filter(
        (item) =>
          this.state.filteredTypes.length === 0 || this.state.filteredTypes.includes(item.type)
      )
      .slice(startIndex, lastIndex);
  };

  private fetchItems = () => {
    this.setState(
      {
        isFetchingItems: true,
      },
      this.debouncedFetch.bind(null, this.state.query)
    );
  };

  private getAvailableSavedObjectMetaData() {
    const typesInItems = new Set<string>();
    this.state.items.forEach((item) => {
      typesInItems.add(item.type);
    });
    return this.props.savedObjectMetaData.filter((metaData) => typesInItems.has(metaData.type));
  }

  private getSortOptions() {
    const sortOptions = [
      <EuiContextMenuItem
        key="asc"
        icon={
          this.state.sortDirection === 'asc' ||
          (this.state.query === '' && this.state.sortDirection !== 'desc')
            ? 'check'
            : 'empty'
        }
        onClick={() => {
          this.setState({
            sortDirection: 'asc',
          });
        }}
      >
        {i18n.translate('savedObjects.finder.sortAsc', {
          defaultMessage: 'Ascending',
        })}
      </EuiContextMenuItem>,
      <EuiContextMenuItem
        key="desc"
        icon={this.state.sortDirection === 'desc' ? 'check' : 'empty'}
        onClick={() => {
          this.setState({
            sortDirection: 'desc',
          });
        }}
      >
        {i18n.translate('savedObjects.finder.sortDesc', {
          defaultMessage: 'Descending',
        })}
      </EuiContextMenuItem>,
    ];
    if (this.state.query) {
      sortOptions.push(
        <EuiContextMenuItem
          key="auto"
          icon={!this.state.sortDirection ? 'check' : 'empty'}
          onClick={() => {
            this.setState({
              sortDirection: undefined,
            });
          }}
        >
          {i18n.translate('savedObjects.finder.sortAuto', {
            defaultMessage: 'Best match',
          })}
        </EuiContextMenuItem>
      );
    }
    return sortOptions;
  }

  private renderSearchBar() {
    const availableSavedObjectMetaData = this.getAvailableSavedObjectMetaData();

    return (
      <EuiFlexGroup gutterSize="m">
        <EuiFlexItem grow={true}>
          <EuiCompressedFieldSearch
            placeholder={i18n.translate('savedObjects.finder.searchPlaceholder', {
              defaultMessage: 'Search…',
            })}
            aria-label={i18n.translate('savedObjects.finder.searchPlaceholder', {
              defaultMessage: 'Search…',
            })}
            fullWidth
            value={this.state.query}
            onChange={(e) => {
              this.setState(
                {
                  query: e.target.value,
                },
                this.fetchItems
              );
            }}
            data-test-subj="savedObjectFinderSearchInput"
            isLoading={this.state.isFetchingItems}
          />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiFilterGroup>
            <EuiPopover
              id="addPanelSortPopover"
              panelClassName="euiFilterGroup__popoverPanel"
              panelPaddingSize="none"
              isOpen={this.state.sortOpen}
              closePopover={() => this.setState({ sortOpen: false })}
              button={
                <EuiSmallFilterButton
                  onClick={() =>
                    this.setState(({ sortOpen }) => ({
                      sortOpen: !sortOpen,
                    }))
                  }
                  iconType="arrowDown"
                  isSelected={this.state.sortOpen}
                  data-test-subj="savedObjectFinderSortButton"
                >
                  {i18n.translate('savedObjects.finder.sortButtonLabel', {
                    defaultMessage: 'Sort',
                  })}
                </EuiSmallFilterButton>
              }
            >
              <EuiContextMenuPanel
                watchedItemProps={['icon', 'disabled']}
                items={this.getSortOptions()}
                size="s"
              />
            </EuiPopover>
            {this.props.showFilter && (
              <EuiPopover
                id="addPanelFilterPopover"
                panelClassName="euiFilterGroup__popoverPanel"
                panelPaddingSize="none"
                isOpen={this.state.filterOpen}
                closePopover={() => this.setState({ filterOpen: false })}
                button={
                  <EuiSmallFilterButton
                    onClick={() =>
                      this.setState(({ filterOpen }) => ({
                        filterOpen: !filterOpen,
                      }))
                    }
                    iconType="arrowDown"
                    data-test-subj="savedObjectFinderFilterButton"
                    isSelected={this.state.filterOpen}
                    numFilters={this.props.savedObjectMetaData.length}
                    hasActiveFilters={this.state.filteredTypes.length > 0}
                    numActiveFilters={this.state.filteredTypes.length}
                  >
                    {i18n.translate('savedObjects.finder.filterButtonLabel', {
                      defaultMessage: 'Types',
                    })}
                  </EuiSmallFilterButton>
                }
              >
                <EuiContextMenuPanel
                  watchedItemProps={['icon', 'disabled']}
                  size="s"
                  items={this.props.savedObjectMetaData.map((metaData) => (
                    <EuiContextMenuItem
                      key={metaData.type}
                      disabled={!availableSavedObjectMetaData.includes(metaData)}
                      icon={this.state.filteredTypes.includes(metaData.type) ? 'check' : 'empty'}
                      data-test-subj={`savedObjectFinderFilter-${metaData.type}`}
                      onClick={() => {
                        this.setState(({ filteredTypes }) => ({
                          filteredTypes: filteredTypes.includes(metaData.type)
                            ? filteredTypes.filter((t) => t !== metaData.type)
                            : [...filteredTypes, metaData.type],
                          page: 0,
                        }));
                      }}
                    >
                      {metaData.name}
                    </EuiContextMenuItem>
                  ))}
                />
              </EuiPopover>
            )}
          </EuiFilterGroup>
        </EuiFlexItem>
        {this.props.children ? <EuiFlexItem grow={false}>{this.props.children}</EuiFlexItem> : null}
      </EuiFlexGroup>
    );
  }

  private renderListing() {
    const items = this.state.items.length === 0 ? [] : this.getPageOfItems();
    const { onChoose, savedObjectMetaData } = this.props;

    return (
      <>
        {this.state.isFetchingItems && this.state.items.length === 0 && (
          <EuiFlexGroup justifyContent="center">
            <EuiFlexItem grow={false}>
              <EuiSpacer />
              <EuiLoadingSpinner data-test-subj="savedObjectFinderLoadingIndicator" />
            </EuiFlexItem>
          </EuiFlexGroup>
        )}
        {items.length > 0 ? (
          <EuiListGroup data-test-subj="savedObjectFinderItemList" maxWidth={false}>
            {items.map((item) => {
              const currentSavedObjectMetaData = savedObjectMetaData.find(
                (metaData) => metaData.type === item.type
              )!;
              const fullName = currentSavedObjectMetaData.getTooltipForSavedObject
                ? currentSavedObjectMetaData.getTooltipForSavedObject(item.savedObject)
                : `${item.title} (${currentSavedObjectMetaData!.name})`;
              const iconType = (
                currentSavedObjectMetaData ||
                ({
                  getIconForSavedObject: () => 'document',
                } as Pick<SavedObjectMetaData<{ title: string }>, 'getIconForSavedObject'>)
              ).getIconForSavedObject(item.savedObject);
              return (
                <EuiListGroupItem
                  size="s"
                  key={item.id}
                  iconType={iconType}
                  label={item.title}
                  onClick={
                    onChoose
                      ? () => {
                          onChoose(item.id, item.type, fullName, item.savedObject);
                        }
                      : undefined
                  }
                  title={fullName}
                  data-test-subj={`savedObjectTitle${(item.title || '').split(' ').join('-')}`}
                />
              );
            })}
          </EuiListGroup>
        ) : (
          !this.state.isFetchingItems && <EuiEmptyPrompt body={this.props.noItemsMessage} />
        )}
        {this.getPageCount() > 1 &&
          (this.props.fixedPageSize ? (
            <EuiPagination
              activePage={this.state.page}
              pageCount={this.getPageCount()}
              onPageClick={(page) => {
                this.setState({
                  page,
                });
              }}
            />
          ) : (
            <EuiTablePagination
              activePage={this.state.page}
              pageCount={this.getPageCount()}
              onChangePage={(page) => {
                this.setState({
                  page,
                });
              }}
              onChangeItemsPerPage={(perPage) => {
                this.setState({
                  perPage,
                });
              }}
              itemsPerPage={this.state.perPage}
              itemsPerPageOptions={[5, 10, 15, 25]}
            />
          ))}
      </>
    );
  }
}

const getSavedObjectFinder = (
  savedObject: SavedObjectsStart,
  uiSettings: IUiSettingsClient,
  data?: DataPublicPluginStart,
  application?: ApplicationStart
) => {
  return (props: SavedObjectFinderProps) => (
    <SavedObjectFinderUi
      {...props}
      savedObjects={savedObject}
      uiSettings={uiSettings}
      data={data}
      application={application}
    />
  );
};

export { getSavedObjectFinder, SavedObjectFinderUi };
