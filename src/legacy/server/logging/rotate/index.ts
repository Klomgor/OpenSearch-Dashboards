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

// @ts-expect-error TS2614, TS2724 TODO(ts-error): fixme
import { isMaster as isClusterManager, isWorker } from 'cluster';
import { Server } from '@hapi/hapi';
import { LogRotator } from './log_rotator';
import { OpenSearchDashboardsConfig } from '../../osd_server';

let logRotator: LogRotator;

export async function setupLoggingRotate(server: Server, config: OpenSearchDashboardsConfig) {
  // If log rotate is not enabled we skip
  if (!config.get('logging.rotate.enabled')) {
    return;
  }

  // We just want to start the logging rotate service once
  // and we choose to use the master (prod) or the worker server (dev)
  if (!isClusterManager && isWorker && process.env.osdWorkerType !== 'server') {
    return;
  }

  // We don't want to run logging rotate server if
  // we are not logging to a file
  if (config.get('logging.dest') === 'stdout') {
    server.log(
      ['warning', 'logging:rotate'],
      'Log rotation is enabled but logging.dest is configured for stdout. Set logging.dest to a file for this setting to take effect.'
    );
    return;
  }

  // Enable Logging Rotate Service
  // We need the master process and it can
  // try to setupLoggingRotate more than once,
  // so we'll need to assure it only loads once.
  if (!logRotator) {
    logRotator = new LogRotator(config, server);
    await logRotator.start();
  }

  return logRotator;
}
