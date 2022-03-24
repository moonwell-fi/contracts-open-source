
# Run a single cvl e.g.:
#  make -B spec/certora/QiErc20/borrowAndRepayFresh.cvl

# TODO:
#  - mintAndRedeemFresh.cvl in progress and is failing due to issues with tool proving how the exchange rate can change
#    hoping for better division modelling - currently fails to prove (a + 1) / b >= a / b
#  - QiErc20Delegator/*.cvl cannot yet be run with the tool
#  - qiDAI proofs are WIP, require using the delegate and the new revert message assertions

.PHONY: certora-clean

CERTORA_BIN = $(abspath script/certora)
CERTORA_RUN = $(CERTORA_BIN)/run.py
CERTORA_CLI = $(CERTORA_BIN)/cli.jar
CERTORA_EMV = $(CERTORA_BIN)/emv.jar

export CERTORA = $(CERTORA_BIN)
export CERTORA_DISABLE_POPUP = 1

spec/certora/Math/%.cvl:
	$(CERTORA_RUN) \
	 spec/certora/contracts/MathCertora.sol \
	--verify \
	 MathCertora:$@

spec/certora/Benqi/search.cvl:
	$(CERTORA_RUN) \
	spec/certora/contracts/QiCertora.sol \
	--settings -b=4,-graphDrawLimit=0,-assumeUnwindCond,-depth=100 \
	--solc_args "'--evm-version istanbul'" \
	--verify \
	 QiCertora:$@

spec/certora/Benqi/transfer.cvl:
	$(CERTORA_RUN) \
	spec/certora/contracts/QiCertora.sol \
	--settings -graphDrawLimit=0,-assumeUnwindCond,-depth=100 \
	--solc_args "'--evm-version istanbul'" \
	--verify \
	 QiCertora:$@

spec/certora/Governor/%.cvl:
	$(CERTORA_RUN) \
	 spec/certora/contracts/GovernorAlphaCertora.sol \
	 spec/certora/contracts/TimelockCertora.sol \
	 spec/certora/contracts/QiCertora.sol \
	 --settings -assumeUnwindCond,-enableWildcardInlining=false \
	 --solc_args "'--evm-version istanbul'" \
	 --link \
	 GovernorAlphaCertora:timelock=TimelockCertora \
	 GovernorAlphaCertora:benqi=QiCertora \
	--verify \
	 GovernorAlphaCertora:$@

spec/certora/Comptroller/%.cvl:
	$(CERTORA_RUN) \
	 spec/certora/contracts/ComptrollerCertora.sol \
	 spec/certora/contracts/PriceOracleModel.sol \
	--link \
	 ComptrollerCertora:oracle=PriceOracleModel \
	--verify \
	 ComptrollerCertora:$@

spec/certora/qiDAI/%.cvl:
	$(CERTORA_RUN) \
	 spec/certora/contracts/QiDaiDelegateCertora.sol \
	 spec/certora/contracts/UnderlyingModelNonStandard.sol \
	 spec/certora/contracts/mcd/dai.sol:Dai \
	 spec/certora/contracts/mcd/pot.sol:Pot \
	 spec/certora/contracts/mcd/vat.sol:Vat \
	 spec/certora/contracts/mcd/join.sol:DaiJoin \
	 tests/Contracts/BoolComptroller.sol \
	--link \
	 QiDaiDelegateCertora:comptroller=BoolComptroller \
	 QiDaiDelegateCertora:underlying=Dai \
	 QiDaiDelegateCertora:potAddress=Pot \
	 QiDaiDelegateCertora:vatAddress=Vat \
	 QiDaiDelegateCertora:daiJoinAddress=DaiJoin \
	--verify \
	 QiDaiDelegateCertora:$@ \
	--settings -cache=certora-run-qidai

spec/certora/QiErc20/%.cvl:
	$(CERTORA_RUN) \
	 spec/certora/contracts/QiErc20ImmutableCertora.sol \
	 spec/certora/contracts/QiTokenCollateral.sol \
	 spec/certora/contracts/ComptrollerCertora.sol \
	 spec/certora/contracts/InterestRateModelModel.sol \
	 spec/certora/contracts/UnderlyingModelNonStandard.sol \
	--link \
	 QiErc20ImmutableCertora:otherToken=QiTokenCollateral \
	 QiErc20ImmutableCertora:comptroller=ComptrollerCertora \
	 QiErc20ImmutableCertora:underlying=UnderlyingModelNonStandard \
	 QiErc20ImmutableCertora:interestRateModel=InterestRateModelModel \
	 QiTokenCollateral:comptroller=ComptrollerCertora \
	 QiTokenCollateral:underlying=UnderlyingModelNonStandard \
	--verify \
	 QiErc20ImmutableCertora:$@ \
	--settings -cache=certora-run-qierc20-immutable

spec/certora/QiErc20Delegator/%.cvl:
	$(CERTORA_RUN) \
	 spec/certora/contracts/QiErc20DelegatorCertora.sol \
	 spec/certora/contracts/QiErc20DelegateCertora.sol \
	 spec/certora/contracts/QiTokenCollateral.sol \
	 spec/certora/contracts/ComptrollerCertora.sol \
	 spec/certora/contracts/InterestRateModelModel.sol \
	 spec/certora/contracts/UnderlyingModelNonStandard.sol \
	--link \
	 QiErc20DelegatorCertora:implementation=QiErc20DelegateCertora \
	 QiErc20DelegatorCertora:otherToken=QiTokenCollateral \
	 QiErc20DelegatorCertora:comptroller=ComptrollerCertora \
	 QiErc20DelegatorCertora:underlying=UnderlyingModelNonStandard \
	 QiErc20DelegatorCertora:interestRateModel=InterestRateModelModel \
	 QiTokenCollateral:comptroller=ComptrollerCertora \
	 QiTokenCollateral:underlying=UnderlyingModelNonStandard \
	--verify \
	 QiErc20DelegatorCertora:$@ \
	--settings -assumeUnwindCond \
	--settings -cache=certora-run-qierc20-delegator

spec/certora/Maximillion/%.cvl:
	$(CERTORA_RUN) \
	 spec/certora/contracts/MaximillionCertora.sol \
	 spec/certora/contracts/QiAvaxCertora.sol \
	--link \
	 MaximillionCertora:qiAvax=QiAvaxCertora \
	--verify \
	 MaximillionCertora:$@

spec/certora/Timelock/%.cvl:
	$(CERTORA_RUN) \
	 spec/certora/contracts/TimelockCertora.sol \
	--verify \
	 TimelockCertora:$@

certora-clean:
	rm -rf .certora_build.json .certora_config certora_verify.json emv-*
