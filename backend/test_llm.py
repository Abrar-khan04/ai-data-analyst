import sys
from llm_client import nl_to_operation_via_llm

if __name__ == "__main__":
    try:
        res = nl_to_operation_via_llm("test", ["a", "b"], {"a": "int", "b": "str"}, "1,test")
        print("Success:", res)
    except Exception as e:
        print("Error:", e)
        import traceback
        traceback.print_exc()
