// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import * as sinon from 'sinon';

import * as loader from '../../libs/voicefocus/loader';
import { BackgroundFilterSpec } from '../../src';
import BackgroundBlurOptions from '../../src/backgroundblurprocessor/BackgroundBlurOptions';
import BackgroundBlurProcessorBuiltIn from '../../src/backgroundblurprocessor/BackgroundBlurProcessorBuiltIn';
import BackgroundBlurProcessorProvided from '../../src/backgroundblurprocessor/BackgroundBlurProcessorProvided';
import BlurStrength from '../../src/backgroundblurprocessor/BackgroundBlurStrength';
import BackgroundBlurVideoFrameProcessor from '../../src/backgroundblurprocessor/BackgroundBlurVideoFrameProcessor';
import BackgroundBlurVideoFrameProcessorObserver from '../../src/backgroundblurprocessor/BackgroundBlurVideoFrameProcessorObserver';
import ModelSpecBuilder from '../../src/backgroundblurprocessor/ModelSpecBuilder';
import BackgroundFilterFrameCounter from '../../src/backgroundfilter/BackgroundFilterFrameCounter';
import {
  FilterCPUUtilizationHighEvent,
  FilterFrameDurationHighEvent,
} from '../../src/backgroundfilter/BackgroundFilterVideoFrameProcessorObserver';
import DefaultEventController from '../../src/eventcontroller/DefaultEventController';
import EventController from '../../src/eventcontroller/EventController';
import ConsoleLogger from '../../src/logger/ConsoleLogger';
import LogLevel from '../../src/logger/LogLevel';
import NoOpDebugLogger from '../../src/logger/NoOpDebugLogger';
import MeetingSessionConfiguration from '../../src/meetingsession/MeetingSessionConfiguration';
import MeetingSessionCredentials from '../../src/meetingsession/MeetingSessionCredentials';
import MeetingSessionURLs from '../../src/meetingsession/MeetingSessionURLs';
import CanvasVideoFrameBuffer from '../../src/videoframeprocessor/CanvasVideoFrameBuffer';
import NoOpVideoFrameProcessor from '../../src/videoframeprocessor/NoOpVideoFrameProcessor';
import VideoFrameBuffer from '../../src/videoframeprocessor/VideoFrameBuffer';
import DOMMockBehavior from '../dommock/DOMMockBehavior';
import DOMMockBuilder from '../dommock/DOMMockBuilder';
import BackgroundFilterCommon from './BackgroundFilterCommon';

chai.use(chaiAsPromised);
chai.should();

describe('BackgroundBlurProcessor', () => {
  const noOpLogger: NoOpDebugLogger = new NoOpDebugLogger();
  let configuration: MeetingSessionConfiguration;
  let eventController: EventController;
  let expect: Chai.ExpectStatic;
  let domMockBuilder: DOMMockBuilder;
  let domMockBehavior: DOMMockBehavior;
  const sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let clock: sinon.SinonFakeTimers;
  const backgroundFilterCommon = new BackgroundFilterCommon();

  function makeSessionConfiguration(): MeetingSessionConfiguration {
    const configuration = new MeetingSessionConfiguration();
    configuration.meetingId = 'foo-meeting';
    configuration.urls = new MeetingSessionURLs();
    configuration.urls.audioHostURL = 'https://audiohost.test.example.com';
    configuration.urls.turnControlURL = 'https://turncontrol.test.example.com';
    configuration.urls.signalingURL = 'https://signaling.test.example.com';
    configuration.credentials = new MeetingSessionCredentials();
    configuration.credentials.attendeeId = 'foo-attendee';
    configuration.credentials.joinToken = 'foo-join-token';
    configuration.attendeePresenceTimeoutMs = 5000;
    return configuration;
  }

  beforeEach(() => {
    expect = chai.expect;
    clock = sandbox.useFakeTimers();
    domMockBehavior = new DOMMockBehavior();
    domMockBuilder = new DOMMockBuilder(domMockBehavior);
    backgroundFilterCommon.setSandbox(sandbox);
  });

  afterEach(() => {
    sandbox.restore();
    domMockBuilder.cleanup();
  });

  const stubSupported = (supported: boolean, providedSupported: boolean = true): void => {
    sandbox.stub(BackgroundBlurVideoFrameProcessor, 'isSupported').callsFake(
      (): Promise<boolean> => {
        return Promise.resolve(supported);
      }
    );
    sandbox.stub(BackgroundBlurProcessorProvided, 'isSupported').callsFake(
      (): Promise<boolean> => {
        return Promise.resolve(providedSupported);
      }
    );
  };

  describe('BackgroundBlurProcessorProvided', () => {
    describe('construction', () => {
      it('can be created when not supported', async () => {
        backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
        stubSupported(false);

        const bbprocessor = await BackgroundBlurVideoFrameProcessor.create();

        //can add and remove observer
        bbprocessor.addObserver({});
        bbprocessor.removeObserver({});

        expect(bbprocessor).to.be.instanceOf(NoOpVideoFrameProcessor);
        bbprocessor.setBlurStrength(1);
        await bbprocessor.loadAssets();
        await bbprocessor.destroy();
      });

      it('provided cannot be created with invalid inputs', async () => {
        const validSpec = {
          paths: {
            worker: 'worker',
            wasm: 'wasm',
            simd: 'wasm-simd',
          },
          model: ModelSpecBuilder.builder().withSelfieSegmentationDefaults().build(),
        };
        const validOptions: BackgroundBlurOptions = {
          logger: new ConsoleLogger('test', LogLevel.INFO),
          reportingPeriodMillis: 1000,
          blurStrength: 10,
          filterCPUUtilization: 1,
        };

        expect(() => new BackgroundBlurProcessorProvided(null, validOptions)).to.throw(
          'processor has null spec'
        );
        expect(
          () => new BackgroundBlurProcessorProvided({ ...validSpec, paths: null }, validOptions)
        ).to.throw('processor spec has null paths');
        expect(
          () => new BackgroundBlurProcessorProvided({ ...validSpec, model: null }, validOptions)
        ).to.throw('processor spec has null model');

        expect(() => new BackgroundBlurProcessorProvided(validSpec, null)).to.throw(
          'processor has null options'
        );
        expect(
          () => new BackgroundBlurProcessorProvided(validSpec, { ...validOptions, logger: null })
        ).to.throw('processor has null options - logger');
        expect(
          () =>
            new BackgroundBlurProcessorProvided(validSpec, {
              ...validOptions,
              reportingPeriodMillis: null,
            })
        ).to.throw('processor has null options - reportingPeriodMillis');
        expect(
          () =>
            new BackgroundBlurProcessorProvided(validSpec, { ...validOptions, blurStrength: null })
        ).to.throw('processor has null options - blurStrength');
        expect(
          () =>
            new BackgroundBlurProcessorProvided(validSpec, {
              ...validOptions,
              filterCPUUtilization: null,
            })
        ).to.throw('processor has null options - filterCPUUtilization');
      });

      it('can be destroyed when items are null', async () => {
        backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
        stubSupported(true);

        let bbprocessor = (await BackgroundBlurVideoFrameProcessor.create()) as BackgroundBlurProcessorProvided;
        bbprocessor['worker'] = null;
        bbprocessor['targetCanvas'] = null;
        bbprocessor['scaledCanvas'] = null;
        await bbprocessor.destroy();

        bbprocessor = (await BackgroundBlurVideoFrameProcessor.create()) as BackgroundBlurProcessorProvided;
        (bbprocessor['worker'] = await loader.loadWorker(null, null, null)),
          (bbprocessor['targetCanvas'] = document.createElement('canvas'));
        bbprocessor['scaledCanvas'] = document.createElement('canvas');
        await bbprocessor.destroy();
      });

      it('default event handled', async () => {
        backgroundFilterCommon.stubInit({
          initPayload: 2,
          loadModelPayload: 2,
          callInvalidMessage: true,
        });
        stubSupported(true);

        const logger = new ConsoleLogger('BackgroundBlurProcessor', LogLevel.INFO);
        const infoSpy = sandbox.spy(logger, 'info');
        await BackgroundBlurVideoFrameProcessor.create(null, { logger });

        const expectedMsg = JSON.stringify({ msg: 'invalidMessage' }, null, 2);
        expect(infoSpy.calledWith(`unexpected event msg: ${expectedMsg}`)).to.be.true;
      });

      it('can be created with custom logger', async () => {
        backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
        stubSupported(true);

        const logger = {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
          setLogLevel: () => {},
          getLogLevel: () => {
            return LogLevel.DEBUG;
          },
        };
        const bbprocessor = (await BackgroundBlurVideoFrameProcessor.create(null, {
          logger: logger,
        })) as BackgroundBlurProcessorProvided;
        expect(bbprocessor['logger']).to.be.equal(logger);
      });

      it('can be created when supported', async () => {
        backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
        stubSupported(true);

        const expectProcessorResults = async (
          bbprocessor: BackgroundBlurProcessorProvided,
          options: {
            blurStrength: number;
            supported: boolean;
            modelPath: string;
            workerPath: string;
            wasmPath: string;
            simdPath: string;
          }
        ): Promise<void> => {
          await bbprocessor.destroy();
          expect(bbprocessor).to.not.equal(null);
          expect(bbprocessor['_blurStrength']).to.be.equal(options.blurStrength);
          expect(bbprocessor['spec']?.model?.path).to.be.satisfy((msg: string) =>
            msg.startsWith(options.modelPath)
          );
          expect(bbprocessor['spec']?.paths?.worker).to.be.satisfy((msg: string) =>
            msg.startsWith(options.workerPath)
          );
          expect(bbprocessor['spec']?.paths?.wasm).to.be.satisfy((msg: string) =>
            msg.startsWith(options.wasmPath)
          );
          expect(bbprocessor['spec']?.paths?.simd).to.be.satisfy((msg: string) =>
            msg.startsWith(options.simdPath)
          );
        };

        const expectedResults = {
          supported: true,
          blurStrength: BlurStrength.MEDIUM,
          modelPath:
            'https://static.sdkassets.chime.aws/bgblur/models/selfie_segmentation_landscape.tflite',
          workerPath: 'https://static.sdkassets.chime.aws/bgblur/workers/worker.js',
          wasmPath: 'https://static.sdkassets.chime.aws/bgblur/wasm/_cwt-wasm.wasm',
          simdPath: 'https://static.sdkassets.chime.aws/bgblur/wasm/_cwt-wasm-simd.wasm',
        };

        // create processor with defaults
        let bbprocessor = (await BackgroundBlurVideoFrameProcessor.create()) as BackgroundBlurProcessorProvided;
        await bbprocessor.destroy();
        await expectProcessorResults(bbprocessor, {
          ...expectedResults,
        });

        // create processor with paths only
        bbprocessor = (await BackgroundBlurVideoFrameProcessor.create({
          paths: {
            worker: 'http://worker',
            wasm: 'http://wasm',
            simd: 'http://simd',
          },
        })) as BackgroundBlurProcessorProvided;
        await bbprocessor.destroy();
        await expectProcessorResults(bbprocessor, {
          ...expectedResults,
          workerPath: 'http://worker',
          wasmPath: 'http://wasm',
          simdPath: 'http://simd',
        });

        // create processor with model and paths defined
        bbprocessor = (await BackgroundBlurVideoFrameProcessor.create({
          paths: {
            worker: 'http://worker',
            wasm: 'http://wasm',
            simd: 'http://simd',
          },
          model: {
            path: 'http://model',
            input: { height: 1, width: 1, channels: 3, range: [0, 1] },
            output: { height: 1, width: 1, channels: 3, range: [0, 1] },
          },
        })) as BackgroundBlurProcessorProvided;
        await bbprocessor.destroy();
        await expectProcessorResults(bbprocessor, {
          ...expectedResults,
          modelPath: 'http://model',
          workerPath: 'http://worker',
          wasmPath: 'http://wasm',
          simdPath: 'http://simd',
        });

        // create processor with model only
        bbprocessor = (await BackgroundBlurVideoFrameProcessor.create({
          model: {
            path: 'http://model',
            input: { height: 1, width: 1, channels: 3, range: [0, 1] },
            output: { height: 1, width: 1, channels: 3, range: [0, 1] },
          },
        })) as BackgroundBlurProcessorProvided;
        await bbprocessor.destroy();
        await expectProcessorResults(bbprocessor, {
          ...expectedResults,
          modelPath: 'http://model',
        });

        // create processor with asset group
        bbprocessor = (await BackgroundBlurVideoFrameProcessor.create({
          paths: {
            worker: 'http://worker',
            wasm: 'http://wasm',
            simd: 'http://simd',
          },
          model: {
            path: 'http://model',
            input: { height: 1, width: 1, channels: 3, range: [0, 1] },
            output: { height: 1, width: 1, channels: 3, range: [0, 1] },
          },
          assetGroup: 'asset_group',
        })) as BackgroundBlurProcessorProvided;
        await bbprocessor.destroy();
        await expectProcessorResults(bbprocessor, {
          ...expectedResults,
          modelPath: 'http://model/?assetGroup=asset_group',
          workerPath: 'http://worker/?assetGroup=asset_group',
          wasmPath: 'http://wasm/?assetGroup=asset_group',
          simdPath: 'http://simd/?assetGroup=asset_group',
        });

        // create processor with asset group & rev id
        bbprocessor = (await BackgroundBlurVideoFrameProcessor.create({
          paths: {
            worker: 'http://worker',
            wasm: 'http://wasm',
            simd: 'http://simd',
          },
          model: {
            path: 'http://model',
            input: { height: 1, width: 1, channels: 3, range: [0, 1] },
            output: { height: 1, width: 1, channels: 3, range: [0, 1] },
          },
          assetGroup: 'asset_group',
          revisionID: 'rev_id',
        })) as BackgroundBlurProcessorProvided;
        await bbprocessor.destroy();
        await expectProcessorResults(bbprocessor, {
          ...expectedResults,
          modelPath: 'http://model/?assetGroup=asset_group&revisionID=rev_id',
          workerPath: 'http://worker/?assetGroup=asset_group&revisionID=rev_id',
          wasmPath: 'http://wasm/?assetGroup=asset_group&revisionID=rev_id',
          simdPath: 'http://simd/?assetGroup=asset_group&revisionID=rev_id',
        });

        //invalid blur strength
        await expect(
          BackgroundBlurVideoFrameProcessor.create(null, {
            blurStrength: -1,
          })
        ).to.be.rejectedWith('invalid value for blur strength: -1');
      });

      it('init module fails', async () => {
        backgroundFilterCommon.stubInit({ initPayload: null, loadModelPayload: 2 });
        stubSupported(true);

        await expect(BackgroundBlurVideoFrameProcessor.create()).to.be.rejectedWith(
          "could not initialize the background blur video frame processor due to 'failed to initialize the module'"
        );
      });

      it('init load model fails', async () => {
        backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: null });
        stubSupported(true);

        await expect(BackgroundBlurVideoFrameProcessor.create()).to.be.rejectedWith(
          "could not initialize the background blur video frame processor due to 'failed to load model! status: null'"
        );
      });

      it('provided is not supported', async () => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.filter = undefined;
        sandbox.stub(canvas, 'getContext').returns(context);
        sandbox.stub(document, 'createElement').returns(canvas);
        expect(await BackgroundBlurProcessorProvided.isSupported()).to.be.false;
      });

      it('provided is supported', async () => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.filter = 'test';
        sandbox.stub(canvas, 'getContext').returns(context);
        sandbox.stub(document, 'createElement').returns(canvas);
        expect(await BackgroundBlurProcessorProvided.isSupported()).to.be.true;
      });
    });

    describe('predict', () => {
      it('not supported is no op', async () => {
        backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
        stubSupported(false);

        const buffers: VideoFrameBuffer[] = [
          new CanvasVideoFrameBuffer(document.createElement('canvas')),
        ];

        const bbprocessor = await BackgroundBlurVideoFrameProcessor.create();
        const output = await bbprocessor.process(buffers);
        expect(output).to.equal(buffers);
      });

      it('no canvas is no op', async () => {
        backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
        stubSupported(true);

        const buffers: VideoFrameBuffer[] = [new CanvasVideoFrameBuffer(null)];
        const bbprocessor = await BackgroundBlurVideoFrameProcessor.create();
        const output = await bbprocessor.process(buffers);
        expect(output).to.equal(buffers);
      });

      it('canvas height or width is 0', async () => {
        backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
        stubSupported(true);

        const canvas = document.createElement('canvas');
        const buffers: VideoFrameBuffer[] = [new CanvasVideoFrameBuffer(canvas)];

        const bbprocessor = await BackgroundBlurVideoFrameProcessor.create();

        canvas.height = 0;
        let output = await bbprocessor.process(buffers);
        expect(output).to.equal(buffers);

        canvas.width = 0;
        output = await bbprocessor.process(buffers);
        expect(output).to.equal(buffers);
      });

      it('can predict', async () => {
        backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
        stubSupported(true);

        const canvas = document.createElement('canvas');
        const buffers: VideoFrameBuffer[] = [new CanvasVideoFrameBuffer(canvas)];

        canvas.height = 540;
        canvas.width = 960;

        const bbprocessor = (await BackgroundBlurVideoFrameProcessor.create(null, {
          reportingPeriodMillis: 1,
        })) as BackgroundBlurProcessorProvided;
        const frameCounter = bbprocessor['frameCounter'];

        await bbprocessor.process(buffers);
        const output = await bbprocessor.process(buffers);
        expect(output[0]).to.equal(bbprocessor['canvasVideoFrameBuffer']);
        expect(frameCounter.processingSegment).to.be.false;

        // confirm no failure when passing in null mask
        bbprocessor.drawImageWithMask(document.createElement('canvas'), null);
        bbprocessor.drawImageWithMask(document.createElement('canvas'), new ImageData(10, 10));
      });

      it('process stopped after destroyed', async () => {
        backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
        stubSupported(true);

        const canvas = document.createElement('canvas');
        const buffers: VideoFrameBuffer[] = [new CanvasVideoFrameBuffer(canvas)];

        canvas.height = 540;
        canvas.width = 960;

        const bbprocessor = (await BackgroundBlurVideoFrameProcessor.create(null, {
          reportingPeriodMillis: 1,
        })) as BackgroundBlurProcessorProvided;
        const drawSpy = sandbox.spy(bbprocessor, 'drawImageWithMask');

        // confirm that draw is not called after processor is destroyed
        expect(drawSpy.callCount).to.equal(0);
        await bbprocessor.process(buffers);
        expect(drawSpy.callCount).to.equal(1);
        await bbprocessor.destroy();
        await bbprocessor.process(buffers);
        expect(drawSpy.callCount).to.equal(1);
      });

      it('processor destroyed while predicting', async () => {
        backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
        stubSupported(true);

        const canvas = document.createElement('canvas');
        const buffers: VideoFrameBuffer[] = [new CanvasVideoFrameBuffer(canvas)];

        canvas.height = 540;
        canvas.width = 960;

        const bbprocessor = (await BackgroundBlurVideoFrameProcessor.create(null, {
          reportingPeriodMillis: 1,
        })) as BackgroundBlurProcessorProvided;

        let drawCount = 0;
        sandbox.stub(bbprocessor, 'drawImageWithMask').callsFake(async () => {
          drawCount++;
          // add a small delay to allow destroy to be called prior to completing
          await new Promise<void>(resolve => {
            setTimeout(() => {
              resolve();
            }, 100);
          });
        });

        // confirm that draw is not called after processor is destroyed
        await bbprocessor.process(buffers);
        expect(drawCount).to.equal(1);
        const procPromise = bbprocessor.process(buffers);
        await bbprocessor.destroy();
        await procPromise;
        expect(drawCount).to.equal(1);
      });

      it('filter CPU sets defaults when out of range', async () => {
        backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
        stubSupported(true);

        let bbprocessor = (await BackgroundBlurVideoFrameProcessor.create(null, {
          filterCPUUtilization: 23,
        })) as BackgroundBlurProcessorProvided;
        expect(bbprocessor['frameCounter']['filterCPUUtilization']).to.equal(23);

        bbprocessor = (await BackgroundBlurVideoFrameProcessor.create(null, {
          filterCPUUtilization: -1,
        })) as BackgroundBlurProcessorProvided;
        expect(bbprocessor['frameCounter']['filterCPUUtilization']).to.equal(30);

        bbprocessor = (await BackgroundBlurVideoFrameProcessor.create(null, {
          filterCPUUtilization: 101,
        })) as BackgroundBlurProcessorProvided;
        expect(bbprocessor['frameCounter']['filterCPUUtilization']).to.equal(30);
      });

      it('filter rate 1', async () => {
        const worker = sandbox.spy(
          backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 }),
          'postMessage'
        );
        stubSupported(true);

        const buffers: VideoFrameBuffer[] = [
          new CanvasVideoFrameBuffer(document.createElement('canvas')),
        ];

        const bbprocessor = (await BackgroundBlurVideoFrameProcessor.create(null, {
          filterCPUUtilization: 100,
        })) as BackgroundBlurProcessorProvided;
        bbprocessor['videoFramesPerFilterUpdate'] = 1;

        worker.resetHistory();
        for (let i = 0; i < 5; i++) {
          await bbprocessor.process(buffers);
        }
        expect(worker.callCount).to.be.equal(5);
      });

      it('filter rate 5', async () => {
        const worker = sandbox.spy(
          backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 }),
          'postMessage'
        );
        stubSupported(true);

        const buffers: VideoFrameBuffer[] = [
          new CanvasVideoFrameBuffer(document.createElement('canvas')),
        ];

        const bbprocessor = (await BackgroundBlurVideoFrameProcessor.create(null, {
          filterCPUUtilization: 100,
        })) as BackgroundBlurProcessorProvided;

        const videoFramesPerFilterUpdate = 5;
        bbprocessor['videoFramesPerFilterUpdate'] = videoFramesPerFilterUpdate;

        worker.resetHistory();

        await bbprocessor.process(buffers);
        expect(worker.callCount).to.be.equal(1);

        worker.resetHistory();
        for (let i = 0; i < videoFramesPerFilterUpdate - 1; i++) {
          await bbprocessor.process(buffers);
          expect(worker.notCalled).to.be.true;
        }

        await bbprocessor.process(buffers);
        expect(worker.callCount).to.be.equal(1);
      });

      it('predict handles failures', async () => {
        backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
        stubSupported(true);

        const canvas = document.createElement('canvas');
        const buffers: VideoFrameBuffer[] = [new CanvasVideoFrameBuffer(canvas)];

        canvas.height = 540;
        canvas.width = 960;

        const bbprocessor = (await BackgroundBlurVideoFrameProcessor.create(null, {
          reportingPeriodMillis: 1,
        })) as BackgroundBlurProcessorProvided;
        sandbox.stub(bbprocessor, 'drawImageWithMask').throws('draw failed');
        clock.tick(10);
        const output = await bbprocessor.process(buffers);

        expect(output[0]).to.be.deep.equal(buffers[0]);
      });

      it('can predict when model not initialized', async () => {
        backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
        stubSupported(true);

        const canvas = document.createElement('canvas');
        const buffers: VideoFrameBuffer[] = [new CanvasVideoFrameBuffer(canvas)];

        canvas.height = 540;
        canvas.width = 960;

        const bbprocessor = (await BackgroundBlurVideoFrameProcessor.create(null, {
          reportingPeriodMillis: 1,
        })) as BackgroundBlurProcessorProvided;
        bbprocessor['modelInitialized'] = false;
        const output = await bbprocessor.process(buffers);
        expect(output[0]).to.be.equal(buffers[0]);
      });

      it('can predict when input dimensions are interchanged', async () => {
        backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
        stubSupported(true);

        const canvas = document.createElement('canvas');
        let buffers: VideoFrameBuffer[] = [new CanvasVideoFrameBuffer(canvas)];

        canvas.height = 540;
        canvas.width = 960;

        const bbprocessor = (await BackgroundBlurVideoFrameProcessor.create(null, {
          reportingPeriodMillis: 1,
        })) as BackgroundBlurProcessorProvided;

        let output = await bbprocessor.process(buffers);
        expect(output[0]).to.equal(bbprocessor['canvasVideoFrameBuffer']);

        canvas.height = 960;
        canvas.width = 540;
        buffers = [new CanvasVideoFrameBuffer(canvas)];
        output = await bbprocessor.process(buffers);
        expect(output[0]).to.equal(bbprocessor['canvasVideoFrameBuffer']);

        await bbprocessor.destroy();
      });
    });

    it('is supported', async () => {
      const logger = new ConsoleLogger('BackgroundBlurProcessor', LogLevel.INFO);
      const supportedCheck = async (expected: boolean): Promise<void> => {
        expect(await BackgroundBlurVideoFrameProcessor.isSupported(null, { logger })).to.be.equal(
          expected
        );
        sandbox.restore();
      };

      // everything is supported
      backgroundFilterCommon.stubFineGrainSupport({});
      await supportedCheck(true);

      // worker terminate is swallowed and is still supported
      backgroundFilterCommon.stubFineGrainSupport({ workerTerminateThrows: true });
      await supportedCheck(true);

      // browser does not support worker
      backgroundFilterCommon.stubFineGrainSupport({ supportsWorker: false });
      await supportedCheck(false);

      // browser does not support WASM
      backgroundFilterCommon.stubFineGrainSupport({ supportsWASM: false });
      await supportedCheck(false);

      // browser does not support loading worker
      backgroundFilterCommon.stubFineGrainSupport({ loadWorkerRejects: true });
      await supportedCheck(false);
    });

    describe('browser support', () => {
      const setUserAgent = (userAgent: string): void => {
        // @ts-ignore
        navigator.userAgent = userAgent;
      };

      it('is browser supported', async () => {
        backgroundFilterCommon.stubFineGrainSupport({});
        const logger = new ConsoleLogger('BackgroundBlurProcessor', LogLevel.INFO);

        const supportedUserAgents = [
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3865.75 Safari/537.36',
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Safari/605.1.15',
          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/107.0.5304.66 Mobile/15E148 Safari/604.1',
          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/106.0 Mobile/15E148 Safari/605.1.15',
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/111 Version/13.0.3 Safari/605.1.15',
        ];
        for (const supportedUserAgent of supportedUserAgents) {
          setUserAgent(supportedUserAgent);
          await expect(
            await BackgroundBlurVideoFrameProcessor.isSupported(null, { logger })
          ).to.be.equal(true);
        }

        const notSupportedUserAgents = [
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1.2 Safari/605.1.15',
          'Mozilla/5.0 (iPhone; CPU iPhone OS 10_3 like Mac OS X) AppleWebKit/602.1.50 (KHTML, like Gecko) CriOS/88.0.4324.152 Mobile/14E5239e Safari/602.1',
          'Mozilla/5.0 (iPhone; CPU iPhone OS 12_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/29.1.0 Mobile/16B91 Safari/605.1.15',
        ];
        for (const notSupportedUserAgent of notSupportedUserAgents) {
          setUserAgent(notSupportedUserAgent);
          await expect(
            await BackgroundBlurVideoFrameProcessor.isSupported(null, { logger })
          ).to.be.equal(false);
        }
      });
    });

    describe('processor filter observer', async () => {
      let bbprocessor: BackgroundBlurProcessorProvided;
      let frameCounter: BackgroundFilterFrameCounter;
      let observer: BackgroundBlurVideoFrameProcessorObserver;
      let cpuMonitor: { frameReceived: () => void };

      const framerate = 15;

      let observedDurationHighEvent: FilterFrameDurationHighEvent;
      let durationHighCallCount = 0;

      let observedCpuHighEvent: FilterCPUUtilizationHighEvent;
      let cpuHighCallCount = 0;

      const expectSegmentCount = (): Chai.Assertion => {
        return expect(frameCounter['filterCount']);
      };

      const expectSegmentTotalMillis = (): Chai.Assertion => {
        return expect(frameCounter['filterTotalMillis']);
      };

      const expectRate = (): Chai.Assertion => {
        return expect(bbprocessor['videoFramesPerFilterUpdate']);
      };

      beforeEach(async () => {
        backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
        stubSupported(true);

        clock.reset();
        observedDurationHighEvent = null;
        durationHighCallCount = 0;
        observedCpuHighEvent = null;
        cpuHighCallCount = 0;

        bbprocessor = (await BackgroundBlurVideoFrameProcessor.create(null, {
          filterCPUUtilization: 50,
        })) as BackgroundBlurProcessorProvided;
        frameCounter = bbprocessor['frameCounter'];
        cpuMonitor = bbprocessor['cpuMonitor'];

        observer = {
          filterFrameDurationHigh: event => {
            observedDurationHighEvent = event;
            durationHighCallCount++;
          },
          filterCPUUtilizationHigh: event => {
            observedCpuHighEvent = event;
            cpuHighCallCount++;
          },
        };
        bbprocessor.addObserver(observer);
      });

      it('observer is called when filtering duration high', async () => {
        for (let i = 0; i < framerate - 1; i++) {
          frameCounter.filterSubmitted();
          clock.tick(1000 / framerate + 10);
          frameCounter.filterComplete();
          frameCounter.frameReceived(framerate);
        }
        frameCounter.frameReceived(framerate);
        frameCounter.frameReceived(framerate);
        expect(observedDurationHighEvent).to.be.deep.equal({
          framesDropped: 2,
          avgFilterDurationMillis: 77,
          framerate: 15,
          periodMillis: 1073,
        });
        expect(durationHighCallCount).to.be.equal(1);
        expectSegmentCount().to.be.equal(0);
        expectSegmentTotalMillis().to.be.equal(0);
      });

      it('observer is not called when cpu utilization is low', async () => {
        for (let i = 0; i < 10; i++) {
          frameCounter.filterSubmitted();
          clock.tick(49);
          frameCounter.filterComplete();
          clock.tick(51);
          frameCounter.frameReceived(framerate);
        }

        expect(cpuHighCallCount).to.be.equal(0);
        expect(observedCpuHighEvent).to.be.null;
      });

      it('observer is called when cpu utilization is high', async () => {
        const processFrame = (filterTime: number, otherTime: number): void => {
          cpuMonitor.frameReceived();
          frameCounter.filterSubmitted();
          clock.tick(filterTime);
          frameCounter.filterComplete();
          clock.tick(otherTime);
          frameCounter.frameReceived(framerate);
        };

        // single period where observer fires but rate does not change
        for (let i = 0; i < 10; i++) {
          processFrame(50, 50);
        }

        expect(cpuHighCallCount).to.be.equal(1);
        expect(observedCpuHighEvent).to.be.deep.equal({
          cpuUtilization: 50,
          filterMillis: 500,
          periodMillis: 1000,
        });
        expectRate().to.be.equal(1);

        const maxRate = 10;
        // After 5 seconds of high CPU rate will change.
        for (let i = 0; i < maxRate * 2; i++) {
          processFrame(3000, 2000);
        }

        expect(cpuHighCallCount).to.be.equal(maxRate * 2 + 1);
        expect(observedCpuHighEvent).to.be.deep.equal({
          cpuUtilization: 60,
          filterMillis: 3000,
          periodMillis: 5000,
        });

        // max rate is 10
        expectRate().to.be.equal(maxRate);

        // after 10 seconds of low CPU rate will begin to recover
        // and eventually go back to segmenting every frame.
        for (let i = 0; i < maxRate; i++) {
          processFrame(4000, 6000);
        }
        expect(cpuHighCallCount).to.be.equal(maxRate * 2 + 1);
        expectRate().to.be.equal(1);
      });

      it('observer is not called when filtering duration is low', async () => {
        for (let i = 0; i < 16; i++) {
          frameCounter.filterSubmitted();
          frameCounter.filterComplete();
        }
        clock.tick(1001);
        frameCounter.frameReceived(framerate);
        expect(observedDurationHighEvent).to.be.null;
        expect(durationHighCallCount).to.be.equal(0);
        expectSegmentCount().to.be.equal(0);
        expectSegmentTotalMillis().to.be.equal(0);
      });

      it('observer is not called when removed filter duration is high', async () => {
        const filterDurationSpy = sandbox.spy(bbprocessor['delegate'], 'filterFrameDurationHigh');

        bbprocessor.removeObserver(observer);
        bbprocessor.addObserver({});
        for (let i = 0; i < framerate; i++) {
          frameCounter.filterSubmitted();
          clock.tick(1000 / framerate + 1);
          frameCounter.filterComplete();
        }
        frameCounter.frameReceived(framerate);
        expect(filterDurationSpy.calledOnce).to.be.true;
        expect(observedDurationHighEvent).to.be.null;
        expect(durationHighCallCount).to.be.equal(0);
        expectSegmentCount().to.be.equal(0);
        expectSegmentTotalMillis().to.be.equal(0);
      });
    });

    it('validating eventController events', async () => {
      backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
      stubSupported(true);

      // create processor with defaults
      configuration = makeSessionConfiguration();
      eventController = new DefaultEventController(configuration, noOpLogger);
      const eventController2 = new DefaultEventController(configuration, noOpLogger);
      const bbprocessor = (await BackgroundBlurVideoFrameProcessor.create()) as BackgroundBlurProcessorProvided;
      // first event controller, publishEvent happens
      bbprocessor.setEventController(eventController);
      // second event controller, only change of controller occurs
      bbprocessor.setEventController(eventController2);
    });

    it('observer is called without functions defined', async () => {
      backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
      stubSupported(true);

      const bbprocessor = (await BackgroundBlurVideoFrameProcessor.create()) as BackgroundBlurProcessorProvided;
      bbprocessor.addObserver({});
      const frameCounter = bbprocessor['frameCounter'];
      const framerate = 15;

      frameCounter['lastReportedEventTimestamp'] = Date.now();
      frameCounter.frameReceived(framerate);
      frameCounter['lastReportedEventTimestamp'] = 0;
      frameCounter.frameReceived(framerate);
    });
  });

  describe('BackgroundBlurProcessorBuiltIn', () => {
    it('can predict', async () => {
      backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
      stubSupported(true, false);

      const canvas = document.createElement('canvas');
      const buffers: VideoFrameBuffer[] = [new CanvasVideoFrameBuffer(canvas)];

      canvas.height = 540;
      canvas.width = 960;

      const bbprocessor = (await BackgroundBlurVideoFrameProcessor.create()) as BackgroundBlurProcessorBuiltIn;
      const output = await bbprocessor.process(buffers);
      expect(output[0]).to.equal(bbprocessor['canvasVideoFrameBuffer']);

      // confirm no failure when passing in null mask
      bbprocessor['blurredImage'] = new ImageData(10, 10);
      bbprocessor.drawImageWithMask(document.createElement('canvas'), null);
      bbprocessor.drawImageWithMask(document.createElement('canvas'), new ImageData(10, 10));

      await bbprocessor.destroy();
      expect(bbprocessor).to.be.instanceOf(BackgroundBlurProcessorBuiltIn);
    });

    it('set blur strength', async () => {
      backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
      stubSupported(true, false);

      const canvas = document.createElement('canvas');
      const buffers: VideoFrameBuffer[] = [new CanvasVideoFrameBuffer(canvas)];

      const bbprocessor = (await BackgroundBlurVideoFrameProcessor.create()) as BackgroundBlurProcessorBuiltIn;
      await bbprocessor.process(buffers);
      expect(bbprocessor['_blurStrength']).to.be.equal(BlurStrength.MEDIUM);
      expect(bbprocessor['modelInitialized']).to.be.true;

      // disable post message so load is not immediately handled
      bbprocessor['worker'].postMessage = () => {};

      bbprocessor.setBlurStrength(123);
      expect(bbprocessor['_blurStrength']).to.be.equal(123);
      expect(bbprocessor['modelInitialized']).to.be.false;

      await bbprocessor.handleLoadModel({ payload: 2 });
      expect(bbprocessor['modelInitialized']).to.be.true;
      await bbprocessor.destroy();
    });

    it('can destroy', async () => {
      const worker = sandbox.spy(
        backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 }),
        'postMessage'
      );
      stubSupported(true, false);

      // Verify `stop` is called for BackgroundBlurProcessorBuiltIn
      // when `blurCanvas` is null.
      let bbprocessor = (await BackgroundBlurVideoFrameProcessor.create()) as BackgroundBlurProcessorBuiltIn;
      bbprocessor['blurCanvas'] = null;
      await bbprocessor.destroy();

      // Workers loaded for background blur must maintain API contract
      // of `stop` command existing. Integration tests should exist on
      // the worker code to ensure that it does not change. As a result,
      // a unit test is fine here to ensure that `stop` contract is
      // fulfilled on the client side.
      expect(worker.callCount).to.be.equal(4);
      expect(worker.calledWith({ msg: 'stop' })).to.be.true;
      worker.resetHistory();

      // Verify `stop` is called for BackgroundBlurProcessorBuiltIn
      // when `blurCanvas` is not null.
      bbprocessor = (await BackgroundBlurVideoFrameProcessor.create()) as BackgroundBlurProcessorBuiltIn;
      bbprocessor['blurCanvas'] = document.createElement('canvas');
      await bbprocessor.destroy();

      expect(worker.callCount).to.be.equal(4);
      expect(worker.calledWith({ msg: 'stop' })).to.be.true;
      worker.restore();
    });

    it('initialize handles errors', async () => {
      backgroundFilterCommon.stubInit({ initPayload: null, loadModelPayload: 2 });
      stubSupported(true, false);

      await expect(BackgroundBlurVideoFrameProcessor.create()).to.be.rejectedWith(
        "could not initialize the background blur video frame processor due to 'failed to initialize the module'"
      );
    });

    it('can predict when input dimensions are interchanged', async () => {
      backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
      stubSupported(true, false);

      const canvas = document.createElement('canvas');
      let buffers: VideoFrameBuffer[] = [new CanvasVideoFrameBuffer(canvas)];

      canvas.height = 540;
      canvas.width = 960;

      const bbprocessor = (await BackgroundBlurVideoFrameProcessor.create()) as BackgroundBlurProcessorBuiltIn;

      let output = await bbprocessor.process(buffers);
      expect(output[0]).to.equal(bbprocessor['canvasVideoFrameBuffer']);

      canvas.height = 960;
      canvas.width = 540;
      buffers = [new CanvasVideoFrameBuffer(canvas)];
      output = await bbprocessor.process(buffers);
      expect(output[0]).to.equal(bbprocessor['canvasVideoFrameBuffer']);

      await bbprocessor.destroy();
      expect(bbprocessor).to.be.instanceOf(BackgroundBlurProcessorBuiltIn);
    });
  });

  describe('BackgroundBlurVideoFrameProcessor', () => {
    let spec: BackgroundFilterSpec;
    let options: BackgroundBlurOptions;

    beforeEach(() => {
      spec = {};
      options = {
        blurStrength: BlurStrength.LOW,
      };
    });

    it('create should not change spec and options by reference', async () => {
      backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
      stubSupported(true);

      // create processor
      const bbprocessor = await BackgroundBlurVideoFrameProcessor.create(spec, options);

      // expect spec and options not changed by reference
      expect(spec).to.deep.equal({});
      expect(options).to.deep.equal({ blurStrength: BlurStrength.LOW });

      await bbprocessor.destroy();
    });

    it('isSupported should not change spec and options by reference', async () => {
      backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
      stubSupported(true);

      await BackgroundBlurVideoFrameProcessor.isSupported(spec, options);

      // expect spec and options not changed by reference
      expect(spec).to.deep.equal({});
      expect(options).to.deep.equal({ blurStrength: BlurStrength.LOW });
    });
  });

  describe('BackgroundBlurVideoFrameProcessor', () => {
    let spec: BackgroundFilterSpec;
    let options: BackgroundBlurOptions;

    beforeEach(() => {
      spec = {};
      options = {
        blurStrength: BlurStrength.LOW,
      };
    });

    it('create should not change spec and options by reference', async () => {
      backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
      stubSupported(true);

      // create processor
      const bbprocessor = await BackgroundBlurVideoFrameProcessor.create(spec, options);

      // expect spec and options not changed by reference
      expect(spec).to.deep.equal({});
      expect(options).to.deep.equal({ blurStrength: BlurStrength.LOW });

      await bbprocessor.destroy();
    });

    it('isSupported should not change spec and options by reference', async () => {
      backgroundFilterCommon.stubInit({ initPayload: 2, loadModelPayload: 2 });
      stubSupported(true);

      await BackgroundBlurVideoFrameProcessor.isSupported(spec, options);

      // expect spec and options not changed by reference
      expect(spec).to.deep.equal({});
      expect(options).to.deep.equal({ blurStrength: BlurStrength.LOW });
    });
  });
});
